import type {
  ChatMessage,
  ChatMessagePart,
  SystemPromptEntry,
  ToolCall,
  TranscriptWindow,
  UserContentPart,
} from '../../shared/protocol';
import { cloneToolCall } from '../../shared/chat-message-parts';

export interface TranscriptState {
  /** Per-session transcripts, keyed by session path. */
  bySession: Record<string, ChatMessage[]>;
  /** Per-session system prompts. */
  systemPromptsBySession: Record<string, SystemPromptEntry[]>;
  /** Per-session transcript window metadata. */
  windowBySession: Record<string, TranscriptWindow>;
  /** Maps aliased message IDs to canonical IDs (for multi-turn tool-use merging). */
  messageIdAlias: Record<string, string>;
  /** Tracks the first message ID of the active streaming turn per session. */
  currentTurnBySession: Record<string, { requestId: string; firstMessageId: string }>;
}

export function resolveAlias(aliasMap: Record<string, string>, messageId: string): string {
  return aliasMap[messageId] ?? messageId;
}

export function clearSessionAliases(state: TranscriptState, sessionPath: string): void {
  const sessionMessageIds = new Set<string>();

  for (const message of state.bySession[sessionPath] ?? []) {
    sessionMessageIds.add(message.id);
  }

  const currentTurn = state.currentTurnBySession[sessionPath];
  if (currentTurn) {
    sessionMessageIds.add(currentTurn.firstMessageId);
  }

  if (sessionMessageIds.size === 0) {
    return;
  }

  for (const [aliasId, canonicalId] of Object.entries(state.messageIdAlias)) {
    if (sessionMessageIds.has(aliasId) || sessionMessageIds.has(canonicalId)) {
      delete state.messageIdAlias[aliasId];
    }
  }
}

export function ensureAssistantParts(message: ChatMessage): ChatMessagePart[] {
  if (message.parts) {
    return message.parts;
  }

  const parts: ChatMessagePart[] = [];

  if (message.thinking) {
    parts.push({ kind: 'reasoning', text: message.thinking });
  }
  for (const toolCall of message.toolCalls ?? []) {
    parts.push({ kind: 'toolCall', toolCall: cloneToolCall(toolCall) });
  }
  if (message.markdown) {
    parts.push({ kind: 'text', text: message.markdown });
  }

  message.parts = parts;
  return parts;
}

export function withAssistantParts(message: ChatMessage): ChatMessage {
  if (message.role !== 'assistant' || message.parts) {
    return message;
  }

  const nextMessage = { ...message };
  ensureAssistantParts(nextMessage);
  return nextMessage;
}

export function markdownFromUserParts(
  userParts: UserContentPart[] | undefined,
  fallbackText: string,
): string {
  if (!userParts || userParts.length === 0) {
    return fallbackText;
  }

  const text = userParts
    .filter((part): part is Extract<UserContentPart, { kind: 'text' }> => part.kind === 'text')
    .map((part) => part.text)
    .join('');

  return text || fallbackText;
}

export function appendAssistantTextPart(
  message: ChatMessage,
  kind: 'text' | 'reasoning',
  text: string,
): void {
  if (!text) {
    return;
  }

  const parts = ensureAssistantParts(message);
  const last = parts[parts.length - 1];
  const currentAggregate = kind === 'text' ? message.markdown ?? '' : message.thinking ?? '';
  const needsSeparator =
    currentAggregate.endsWith('\n\n') &&
    last?.kind === kind &&
    !last.text.endsWith('\n\n');
  const partText = needsSeparator ? `\n\n${text}` : text;

  if (last?.kind === kind) {
    last.text += partText;
  } else {
    parts.push({ kind, text: partText });
  }

  if (kind === 'text') {
    message.markdown = (message.markdown ?? '') + text;
  } else {
    message.thinking = (message.thinking ?? '') + text;
  }
}

export function upsertAssistantToolCall(message: ChatMessage, toolCall: ToolCall): void {
  const parts = ensureAssistantParts(message);
  const nextToolCall = cloneToolCall(toolCall);
  const existingToolCalls = message.toolCalls ?? [];
  const toolIndex = existingToolCalls.findIndex((item) => item.id === nextToolCall.id);

  if (toolIndex === -1) {
    message.toolCalls = [...existingToolCalls, nextToolCall];
  } else {
    message.toolCalls = existingToolCalls.map((item) =>
      item.id === nextToolCall.id ? nextToolCall : item,
    );
  }

  const partIndex = parts.findIndex(
    (part) => part.kind === 'toolCall' && part.toolCall.id === nextToolCall.id,
  );
  if (partIndex === -1) {
    parts.push({ kind: 'toolCall', toolCall: nextToolCall });
    return;
  }

  parts[partIndex] = { kind: 'toolCall', toolCall: nextToolCall };
}

export function mergeContinuationToolCalls(message: ChatMessage, incoming: ChatMessage): void {
  const incomingToolCalls = incoming.parts
    ?.filter((part): part is Extract<ChatMessagePart, { kind: 'toolCall' }> => part.kind === 'toolCall')
    .map((part) => part.toolCall)
    ?? incoming.toolCalls
    ?? [];

  for (const toolCall of incomingToolCalls) {
    upsertAssistantToolCall(message, toolCall);
  }
}

export function assistantToolCallsFromMessage(message: ChatMessage): ToolCall[] {
  if (message.role !== 'assistant') {
    return [];
  }

  const partToolCalls = message.parts
    ?.filter((part): part is Extract<ChatMessagePart, { kind: 'toolCall' }> => part.kind === 'toolCall')
    .map((part) => cloneToolCall(part.toolCall));

  if (partToolCalls && partToolCalls.length > 0) {
    return partToolCalls;
  }

  return (message.toolCalls ?? []).map((toolCall) => cloneToolCall(toolCall));
}

export function mergeAssistantToolCallsPreservingResolvedState(
  target: ChatMessage,
  previous: ChatMessage,
): void {
  if (target.role !== 'assistant' || previous.role !== 'assistant') {
    return;
  }

  const currentById = new Map(assistantToolCallsFromMessage(target).map((toolCall) => [toolCall.id, toolCall]));

  for (const previousToolCall of assistantToolCallsFromMessage(previous)) {
    const currentToolCall = currentById.get(previousToolCall.id);

    if (!currentToolCall) {
      upsertAssistantToolCall(target, previousToolCall);
      currentById.set(previousToolCall.id, previousToolCall);
      continue;
    }

    const mergedToolCall: ToolCall = {
      ...currentToolCall,
      name: currentToolCall.name || previousToolCall.name,
      input: currentToolCall.input !== undefined ? currentToolCall.input : previousToolCall.input,
      result: currentToolCall.result !== undefined ? currentToolCall.result : previousToolCall.result,
      status:
        currentToolCall.status === 'failed' || previousToolCall.status !== 'failed'
          ? currentToolCall.status
          : previousToolCall.status,
    };

    upsertAssistantToolCall(target, mergedToolCall);
    currentById.set(mergedToolCall.id, mergedToolCall);
  }
}
