import type { ChatMessage } from '../shared/protocol';

export interface SessionOpenedTranscriptResolution {
  preserveLocal: boolean;
  transcript: ChatMessage[];
}

function hasEphemeralLocalTranscript(localTranscript: ChatMessage[]): boolean {
  return localTranscript.some((message) => message.status === 'streaming' || message.id.startsWith('local:'));
}

export function resolveSessionOpenedTranscript({
  busy,
  incomingTranscript,
  localTranscript,
}: {
  busy: boolean;
  incomingTranscript: ChatMessage[];
  localTranscript: ChatMessage[];
}): SessionOpenedTranscriptResolution {
  const preserveLocal = busy && hasEphemeralLocalTranscript(localTranscript);
  return {
    preserveLocal,
    transcript: preserveLocal ? localTranscript : incomingTranscript,
  };
}
