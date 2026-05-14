import type { ChatMessage, TranscriptWindow } from '../shared/protocol';
import { normalizeTranscriptWindow } from './transcript-window';

export interface SessionOpenedTranscriptResolution {
  preserveLocal: boolean;
  transcript: ChatMessage[];
  transcriptWindow: TranscriptWindow;
}

function isEphemeralMessage(message: ChatMessage): boolean {
  return message.status === 'streaming' || message.id.startsWith('local:');
}

function hasEphemeralLocalTranscript(localTranscript: ChatMessage[]): boolean {
  return localTranscript.some((message) => isEphemeralMessage(message));
}

function userContentSignature(message: ChatMessage): string | null {
  if (message.role !== 'user') {
    return null;
  }

  return JSON.stringify({
    markdown: message.markdown ?? '',
    images: message.userParts?.filter((part) => part.kind === 'image') ?? [],
  });
}

function hasEquivalentIncomingUserAfterLocalPrefix(options: {
  incomingTranscript: ChatMessage[];
  localTranscript: ChatMessage[];
  localIndex: number;
  signature: string;
}): boolean {
  let incomingStartIndex = 0;

  for (let index = options.localIndex - 1; index >= 0; index -= 1) {
    const previousLocalMessage = options.localTranscript[index];
    if (!previousLocalMessage || isEphemeralMessage(previousLocalMessage)) {
      continue;
    }

    const matchingIncomingIndex = options.incomingTranscript.findIndex(
      (message) => message.id === previousLocalMessage.id,
    );
    if (matchingIncomingIndex !== -1) {
      incomingStartIndex = matchingIncomingIndex + 1;
      break;
    }
  }

  return options.incomingTranscript
    .slice(incomingStartIndex)
    .some((message) => userContentSignature(message) === options.signature);
}

function mergeIncomingWithEphemeralLocal(
  incomingTranscript: ChatMessage[],
  localTranscript: ChatMessage[],
): { transcript: ChatMessage[]; appendedCount: number } {
  const merged = [...incomingTranscript];
  const indexById = new Map<string, number>();
  for (let index = 0; index < merged.length; index += 1) {
    indexById.set(merged[index].id, index);
  }

  let appendedCount = 0;
  for (let localIndex = 0; localIndex < localTranscript.length; localIndex += 1) {
    const localMessage = localTranscript[localIndex];
    if (!localMessage || !isEphemeralMessage(localMessage)) {
      continue;
    }

    const existingIndex = indexById.get(localMessage.id);
    if (existingIndex === undefined) {
      const signature = userContentSignature(localMessage);
      if (
        signature
        && hasEquivalentIncomingUserAfterLocalPrefix({
          incomingTranscript,
          localTranscript,
          localIndex,
          signature,
        })
      ) {
        continue;
      }

      indexById.set(localMessage.id, merged.length);
      merged.push(localMessage);
      appendedCount += 1;
      continue;
    }

    // Keep richer local streaming/optimistic state until authoritative data lands.
    merged[existingIndex] = localMessage;
  }

  return { transcript: merged, appendedCount };
}

export function resolveSessionOpenedTranscript({
  busy,
  incomingTranscript,
  incomingTranscriptWindow,
  localTranscript,
}: {
  busy: boolean;
  incomingTranscript: ChatMessage[];
  incomingTranscriptWindow: TranscriptWindow;
  localTranscript: ChatMessage[];
}): SessionOpenedTranscriptResolution {
  const preserveLocal = busy && hasEphemeralLocalTranscript(localTranscript);

  if (!preserveLocal) {
    return {
      preserveLocal,
      transcript: incomingTranscript,
      transcriptWindow: normalizeTranscriptWindow(incomingTranscript, incomingTranscriptWindow),
    };
  }

  const merged = mergeIncomingWithEphemeralLocal(incomingTranscript, localTranscript);
  const mergedWindow: TranscriptWindow = {
    ...incomingTranscriptWindow,
    totalCount: incomingTranscriptWindow.totalCount + merged.appendedCount,
    loadedEnd: Math.min(
      incomingTranscriptWindow.totalCount + merged.appendedCount,
      incomingTranscriptWindow.loadedEnd + merged.appendedCount,
    ),
    hasNewer: incomingTranscriptWindow.hasNewer,
    isPartial:
      incomingTranscriptWindow.isPartial
      || incomingTranscriptWindow.hasOlder
      || incomingTranscriptWindow.hasNewer,
    hasUserMessages: incomingTranscriptWindow.hasUserMessages
      || merged.transcript.some((message) => message.role === 'user'),
  };

  return {
    preserveLocal,
    transcript: merged.transcript,
    transcriptWindow: normalizeTranscriptWindow(merged.transcript, mergedWindow),
  };
}
