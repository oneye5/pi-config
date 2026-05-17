import * as path from 'node:path';

import * as vscode from 'vscode';

import { type RunObserver } from '../stats-service';
import {
  getSessionByPath,
  sessionStateActions,
  store,
  uiActions,
} from '../store';
import type {
  ComposerInput,
  ComposerInputDraft,
  UserContentPart,
} from '../../shared/protocol';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_INPUT_BYTES } from '../../shared/image-constraints';

export function normalizeAttachUris(uris: vscode.Uri[]): vscode.Uri[] {
  return uris.filter((uri) => uri.scheme === 'file');
}

export function upsertPendingComposerInput(sessionPath: string, input: ComposerInput): void {
  const existingInputs = store.getState().sessionState.pendingComposerInputsBySession[sessionPath] ?? [];
  if (input.kind === 'filesystemPathRef') {
    const duplicate = existingInputs.some(
      (existing) => existing.kind === 'filesystemPathRef' && existing.path === input.path,
    );
    if (duplicate) {
      return;
    }
  }

  store.dispatch(sessionStateActions.addPendingComposerInput({ sessionPath, input }));
}

export function validateAndMaterializeComposerInput(
  sessionPath: string,
  inputDraft: ComposerInputDraft,
  createComposerInputId: () => string,
  scheduleRender: () => void,
  runObserver: RunObserver,
): ComposerInput | null {
  if (inputDraft.kind === 'filesystemPathRef') {
    const filesystemPath = inputDraft.path.trim();
    if (!filesystemPath) {
      store.dispatch(uiActions.setNotice('Cannot attach file path: path is empty.'));
      scheduleRender();
      return null;
    }

    return {
      id: createComposerInputId(),
      kind: 'filesystemPathRef',
      path: filesystemPath,
      name: inputDraft.name.trim() || path.basename(filesystemPath) || filesystemPath,
      source: inputDraft.source,
    };
  }

  if (inputDraft.kind === 'imageBlob') {
    const mimeType = inputDraft.mimeType.trim().toLowerCase();
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
      store.dispatch(uiActions.setNotice(`Cannot attach image: unsupported type ${inputDraft.mimeType}.`));
      scheduleRender();
      return null;
    }
    if (!Number.isFinite(inputDraft.sizeBytes) || inputDraft.sizeBytes <= 0) {
      store.dispatch(uiActions.setNotice('Cannot attach image: invalid size.'));
      scheduleRender();
      return null;
    }
    if (inputDraft.sizeBytes > MAX_IMAGE_INPUT_BYTES) {
      store.dispatch(uiActions.setNotice(
        `Cannot attach image: exceeds the ${MAX_IMAGE_INPUT_BYTES} byte limit.`,
      ));
      scheduleRender();
      return null;
    }
    if (!inputDraft.dataBase64.trim()) {
      store.dispatch(uiActions.setNotice('Cannot attach image: missing image data.'));
      scheduleRender();
      return null;
    }
    if (
      inputDraft.width !== undefined
      && (!Number.isFinite(inputDraft.width) || inputDraft.width <= 0)
    ) {
      store.dispatch(uiActions.setNotice('Cannot attach image: invalid width.'));
      scheduleRender();
      return null;
    }
    if (
      inputDraft.height !== undefined
      && (!Number.isFinite(inputDraft.height) || inputDraft.height <= 0)
    ) {
      store.dispatch(uiActions.setNotice('Cannot attach image: invalid height.'));
      scheduleRender();
      return null;
    }
    if (modelSupportsInputKind(sessionPath, undefined, 'image') === false) {
      store.dispatch(uiActions.setNotice('The selected model does not support image inputs.'));
      scheduleRender();
      return null;
    }

    return {
      id: createComposerInputId(),
      kind: 'imageBlob',
      mimeType,
      name: inputDraft.name.trim() || 'image',
      sizeBytes: inputDraft.sizeBytes,
      dataBase64: inputDraft.dataBase64,
      width: inputDraft.width,
      height: inputDraft.height,
      source: inputDraft.source,
    };
  }

  runObserver.onUnsupportedInputAttempt(sessionPath);
  store.dispatch(
    uiActions.setNotice(
      'Arbitrary pasted file attachments are not supported yet. Please attach a filesystem path instead.',
    ),
  );
  scheduleRender();
  return null;
}

export function modelSupportsInputKind(
  sessionPath: string,
  requestedModelId: string | undefined,
  inputKind: 'text' | 'image',
): boolean {
  const state = store.getState();
  const modelId = requestedModelId
    ?? getSessionByPath(state, sessionPath)?.modelId
    ?? state.settings.modelSettings?.defaultModel;
  if (!modelId) {
    return inputKind === 'text';
  }

  const directModels = state.settings.availableModelsBySession[sessionPath] ?? [];
  const fallbackModels = Object.values(state.settings.availableModelsBySession)
    .flatMap((models) => models);
  const model = [...directModels, ...fallbackModels].find((candidate) => candidate.id === modelId);
  if (!model) {
    return inputKind === 'text';
  }

  return model.inputKinds.includes(inputKind);
}

export function clearPendingImageInputs(sessionPath: string): void {
  const existingInputs = store.getState().sessionState.pendingComposerInputsBySession[sessionPath] ?? [];
  const remainingInputs = existingInputs.filter((input) => input.kind !== 'imageBlob');
  if (remainingInputs.length === existingInputs.length) {
    return;
  }
  if (remainingInputs.length === 0) {
    store.dispatch(sessionStateActions.clearPendingComposerInputs(sessionPath));
    return;
  }
  store.dispatch(sessionStateActions.setPendingComposerInputs({
    sessionPath,
    inputs: remainingInputs,
  }));
}

export function buildPromptText(text: string, inputs: ComposerInput[]): string {
  const sections: string[] = [];
  const pathPrelude = inputs
    .filter((input): input is Extract<ComposerInput, { kind: 'filesystemPathRef' }> =>
      input.kind === 'filesystemPathRef')
    .map((input) => `@${input.path}`);
  if (pathPrelude.length > 0) {
    sections.push(pathPrelude.join('\n'));
  }
  if (text.trim()) {
    sections.push(text);
  }
  return sections.join('\n\n');
}

export function buildOptimisticUserParts(
  text: string,
  inputs: ComposerInput[],
): UserContentPart[] | undefined {
  const userParts: UserContentPart[] = [];
  const promptText = buildPromptText(text, inputs);
  if (promptText) {
    userParts.push({ kind: 'text', text: promptText });
  }

  for (const input of inputs) {
    if (input.kind !== 'imageBlob') {
      continue;
    }
    userParts.push({
      kind: 'image',
      mimeType: input.mimeType,
      dataBase64: input.dataBase64,
      name: input.name,
      width: input.width,
      height: input.height,
    });
  }

  return userParts.length > 0 ? userParts : undefined;
}
