import { batch, signal } from '@preact/signals';

import type { ChatMessagePart, HostToWebviewMessage, PatchOp, ViewState } from '../../../shared/protocol';
import { emptyOverlay, applyPatch } from '../overlay';
import { StreamSmoother } from '../stream-smoother';
import type { StreamSmootherPatchSink } from '../stream-smoother';
import {
  appendTextToParts,
  upsertToolCallInParts,
} from '../overlay';

import {
  sessionsSig,
  activeSessionPathSig,
  openTabPathsSig,
  runningSessionPathsSig,
  unreadFinishedSessionPathsSig,
  prefsSig,
  globalUiSig,
  hostMetaSig,
} from './signals';
import {
  getSessionStore,
  disposeSessionStore,
  migrateSessionStore,
  disposeAllSessionStores,
} from './session-store';
import { postMessage } from './actions';

// ─── Per-message signal patch sink ───────────────────────────────────────────

/**
 * Applies a committed PatchOp to per-message signals in the active session store.
 * This is the signal-based replacement for the Overlay map identity change.
 */
function commitPatchToSignals(op: PatchOp): void {
  const activePath = activeSessionPathSig.value;
  if (!activePath) return;
  const store = getSessionStore(activePath);
  const map = store.streamingMapSig.value ?? new Map();

  switch (op.kind) {
    case 'messageDelta': {
      let inner = map.get(op.messageId);
      if (!inner) {
        inner = signal<ChatMessagePart[]>([]);
        const nextMap = new Map(map);
        nextMap.set(op.messageId, inner);
        store.streamingMapSig.value = nextMap;
      }
      const parts = inner.value ? [...inner.value] : [];
      appendTextToParts(parts, 'text', op.delta);
      inner.value = parts;
      break;
    }
    case 'messageThinking': {
      let inner = map.get(op.messageId);
      if (!inner) {
        inner = signal<ChatMessagePart[]>([]);
        const nextMap = new Map(map);
        nextMap.set(op.messageId, inner);
        store.streamingMapSig.value = nextMap;
      }
      const parts = inner.value ? [...inner.value] : [];
      appendTextToParts(parts, 'reasoning', op.thinking);
      inner.value = parts;
      break;
    }
    case 'toolCall': {
      let inner = map.get(op.messageId);
      if (!inner) {
        inner = signal<ChatMessagePart[]>([]);
        const nextMap = new Map(map);
        nextMap.set(op.messageId, inner);
        store.streamingMapSig.value = nextMap;
      }
      const parts = inner.value ? [...inner.value] : [];
      upsertToolCallInParts(parts, op.toolCall);
      inner.value = parts;
      break;
    }
    case 'clearOverlay': {
      if (op.messageIds) {
        let changed = false;
        const nextMap = new Map(map);
        for (const id of op.messageIds) {
          if (nextMap.delete(id)) changed = true;
        }
        if (changed) store.streamingMapSig.value = nextMap;
      } else {
        if (map.size > 0) store.streamingMapSig.value = new Map();
      }
      break;
    }
  }
}

const patchSink: StreamSmootherPatchSink = { commit: commitPatchToSignals };

// ─── Stream smoother (one per webview, routes to active session) ─────────────

let smoother: StreamSmoother | null = null;

function getOrCreateSmoother(): StreamSmoother {
  if (!smoother) {
    smoother = new StreamSmoother({}, (overlay) => {
      const activePath = activeSessionPathSig.value;
      if (!activePath) return;
      const store = getSessionStore(activePath);
      store.overlaySig.value = overlay;
    }, patchSink);
  }
  return smoother;
}

// ─── Pending draft restore ───────────────────────────────────────────────────

const pendingDraftRestores = new Map<string, { text: string }>();

// ─── Token rate tracking ─────────────────────────────────────────────────────

const RATE_WINDOW_SECONDS = 10;

function trackTokenRate(op: PatchOp): void {
  if (op.kind !== 'messageDelta') return;

  const activePath = activeSessionPathSig.value;
  if (!activePath) return;
  const store = getSessionStore(activePath);

  const now = Date.now();
  const chars = op.delta.length;
  const estimatedTokens = chars / 4;
  const samples = store.tokenRateSamples;
  samples.push({ tokens: estimatedTokens, timestamp: now });

  const cutoff = now - RATE_WINDOW_SECONDS * 1000;
  let i = 0;
  while (i < samples.length && samples[i].timestamp < cutoff) i++;
  if (i > 0) samples.splice(0, i);

  if (samples.length >= 2) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = (last.timestamp - first.timestamp) / 1000;
    if (elapsed > 0.5) {
      const totalTokens = samples.reduce((s, p) => s + p.tokens, 0);
      store.tokenRateSig.value = { tokensPerSecond: totalTokens / elapsed, windowSeconds: RATE_WINDOW_SECONDS };
    }
  }
}

// ─── Seed session store from active-session ViewState ────────────────────────

function seedSessionStore(path: string, state: ViewState): void {
  const store = getSessionStore(path);
  store.transcriptSig.value = state.transcript;
  store.transcriptWindowSig.value = state.transcriptWindow;
  store.busySig.value = state.busy;
  store.systemPromptsSig.value = state.systemPrompts;
  store.contextUsageSig.value = state.contextUsage;
  store.fileChangesSig.value = state.fileChanges;
  store.pruningResultSig.value = state.pruningResult;
  store.pendingComposerInputsSig.value = state.pendingComposerInputs;
  store.activeRunSummarySig.value = state.activeRunSummary;
  store.overlaySig.value = emptyOverlay();
  store.streamingMapSig.value = new Map();
}

// ─── Clear transient UI for a session ────────────────────────────────────────

function clearTransientUi(path: string): void {
  const store = getSessionStore(path);
  store.editingIdSig.value = null;
  store.draftRestoreSig.value = null;
  store.tokenRateSamples.length = 0;
  store.tokenRateSig.value = { tokensPerSecond: null, windowSeconds: RATE_WINDOW_SECONDS };
}

// ─── Pending-path migration ──────────────────────────────────────────────────

function reconcileOpenTabs(prevPaths: string[], nextPaths: string[]): void {
  // Check for pending → real path replacements at same index
  for (let i = 0; i < Math.min(prevPaths.length, nextPaths.length); i++) {
    const oldP = prevPaths[i];
    const newP = nextPaths[i];
    if (oldP !== newP && oldP.startsWith('__pending__:') && !nextPaths.includes(oldP)) {
      migrateSessionStore(oldP, newP);
    }
  }

  // Dispose stores for truly closed paths
  const nextSet = new Set(nextPaths);
  for (const oldP of prevPaths) {
    if (!nextSet.has(oldP)) {
      disposeSessionStore(oldP);
    }
  }
}

// ─── Main dispatch ───────────────────────────────────────────────────────────

export function applyHostMessage(msg: HostToWebviewMessage): void {
  if (msg.type === 'state') {
    const sm = getOrCreateSmoother();
    sm.flushAll();
    sm.reset();

    const meta = hostMetaSig.value;
    const hostChanged = meta.instanceId !== '' && meta.instanceId !== msg.hostInstanceId;
    const nextActivePath = msg.state.activeSession?.path ?? null;
    const prevActivePath = activeSessionPathSig.value;
    const sessionChanged = prevActivePath !== null && prevActivePath !== nextActivePath;

    if (hostChanged) {
      disposeAllSessionStores();
      pendingDraftRestores.clear();
    }

    batch(() => {
      hostMetaSig.value = {
        instanceId: msg.hostInstanceId,
        revision: msg.revision,
        awaitingSnapshot: false,
      };

      // Reconcile open tabs before updating
      const prevPaths = openTabPathsSig.value;
      if (!hostChanged) {
        reconcileOpenTabs(prevPaths, msg.state.openTabPaths);
      }

      sessionsSig.value = msg.state.sessions;
      openTabPathsSig.value = msg.state.openTabPaths;
      activeSessionPathSig.value = nextActivePath;
      runningSessionPathsSig.value = msg.state.runningSessionPaths;
      unreadFinishedSessionPathsSig.value = msg.state.unreadFinishedSessionPaths;
      prefsSig.value = msg.state.prefs;
      globalUiSig.value = {
        ...globalUiSig.value,
        notice: msg.state.notice,
      };

      if (hostChanged || sessionChanged) {
        if (prevActivePath) {
          clearTransientUi(prevActivePath);
        }
        globalUiSig.value = {
          contextMenu: null,
          outcomeDialog: false,
          notice: msg.state.notice,
        };
      }

      // Seed the active session store
      if (nextActivePath) {
        seedSessionStore(nextActivePath, msg.state);

        // Check for queued draft restore
        const queued = pendingDraftRestores.get(nextActivePath);
        if (queued) {
          pendingDraftRestores.delete(nextActivePath);
          const store = getSessionStore(nextActivePath);
          store.draftRestoreSig.value = { text: queued.text, nonce: Date.now() };
        }
      }
    });
    return;
  }

  if (msg.type === 'patch') {
    const meta = hostMetaSig.value;

    if (meta.instanceId && meta.instanceId !== msg.hostInstanceId) {
      batch(() => {
        hostMetaSig.value = {
          instanceId: msg.hostInstanceId,
          revision: 0,
          awaitingSnapshot: true,
        };
        const activePath = activeSessionPathSig.value;
        if (activePath) {
          clearTransientUi(activePath);
          const store = getSessionStore(activePath);
          store.overlaySig.value = emptyOverlay();
          store.streamingMapSig.value = new Map();
        }
        globalUiSig.value = {
          contextMenu: null,
          outcomeDialog: false,
          notice: globalUiSig.value.notice,
        };
      });
      postMessage({ type: 'requestSnapshot' });
      return;
    }

    if (msg.revision <= meta.revision) {
      return;
    }

    const expected = meta.revision + 1;
    if (meta.awaitingSnapshot || (meta.revision > 0 && msg.revision !== expected)) {
      if (!meta.awaitingSnapshot) {
        postMessage({ type: 'requestSnapshot' });
      }
      hostMetaSig.value = { ...meta, awaitingSnapshot: true };
      return;
    }

    hostMetaSig.value = { ...meta, revision: msg.revision };

    // Route patch through smoother to active session
    const sm = getOrCreateSmoother();
    sm.processPatch(msg.op);

    trackTokenRate(msg.op);
    return;
  }

  if (msg.type === 'sendRejected') {
    const activePath = activeSessionPathSig.value;
    if (msg.sessionPath === activePath) {
      const store = getSessionStore(msg.sessionPath);
      store.draftRestoreSig.value = { text: msg.text, nonce: Date.now() };
    } else {
      pendingDraftRestores.set(msg.sessionPath, { text: msg.text });
    }
  }
}

/** Reset smoother (for cleanup). */
export function resetSmoother(): void {
  smoother?.reset();
  smoother = null;
}
