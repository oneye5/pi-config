import type {
  ChatMessage,
  ChatMessagePart,
  ThinkingLevel,
  ToolCall,
  UserContentPart,
} from '../../shared/protocol';
import {
  appendAssistantTextPart,
  toolCallsFromMessageParts,
  upsertAssistantToolPart,
} from '../../shared/chat-message-parts';

import type { ContentPart, MessageLike } from './types';

export function isoDate(entryTimestamp: string, messageTimestamp?: number): string {
  if (typeof messageTimestamp === 'number') {
    return new Date(messageTimestamp).toISOString();
  }
  return new Date(entryTimestamp).toISOString();
}

export function textFromParts(parts: ContentPart[] | undefined): string {
  if (!parts) {
    return '';
  }

  return parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('');
}

export function thinkingFromParts(parts: ContentPart[] | undefined): string | undefined {
  if (!parts) {
    return undefined;
  }

  const thinking = parts
    .filter((part) => part.type === 'thinking' && typeof part.thinking === 'string')
    .map((part) => part.thinking ?? '')
    .join('');
  return thinking || undefined;
}

export function userPartsFromContent(content: string | ContentPart[] | undefined): UserContentPart[] | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const userParts: UserContentPart[] = [];
  for (const part of content) {
    if (part.type === 'text' && typeof part.text === 'string') {
      userParts.push({ kind: 'text', text: part.text });
      continue;
    }

    if (
      part.type === 'image'
      && typeof part.data === 'string'
      && part.data.length > 0
      && typeof part.mimeType === 'string'
      && part.mimeType.length > 0
    ) {
      userParts.push({
        kind: 'image',
        mimeType: part.mimeType,
        dataBase64: part.data,
        name: typeof part.name === 'string' ? part.name : undefined,
        width: typeof part.width === 'number' ? part.width : undefined,
        height: typeof part.height === 'number' ? part.height : undefined,
      });
    }
  }

  return userParts.length > 0 ? userParts : undefined;
}

export function normalizeThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
  switch (value) {
    case 'off':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value;
    default:
      return undefined;
  }
}

export function assistantPartsFromContent(
  parts: ContentPart[] | undefined,
  toolCallStatus: ToolCall['status'] = 'running',
): ChatMessagePart[] | undefined {
  if (!parts) {
    return undefined;
  }

  const orderedParts: ChatMessagePart[] = [];
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      appendAssistantTextPart(orderedParts, 'text', part.text);
      continue;
    }

    if (part.type === 'thinking' && typeof part.thinking === 'string') {
      appendAssistantTextPart(orderedParts, 'reasoning', part.thinking);
      continue;
    }

    if (part.type === 'toolCall' && part.id && part.name) {
      upsertAssistantToolPart(orderedParts, {
        id: part.id,
        name: part.name,
        input: part.arguments ?? {},
        status: toolCallStatus,
      });
    }
  }

  return orderedParts.length > 0 ? orderedParts : undefined;
}

export function appendAssistantParts(
  target: ChatMessage,
  incoming: ChatMessagePart[] | undefined,
  preserveLeadingBoundary = false,
): void {
  if (!incoming || incoming.length === 0) {
    return;
  }

  const targetParts = (target.parts ??= []);
  let shouldPreserveBoundary = preserveLeadingBoundary;
  for (const part of incoming) {
    if (part.kind === 'toolCall') {
      upsertAssistantToolPart(targetParts, part.toolCall);
      shouldPreserveBoundary = false;
      continue;
    }

    const last = targetParts[targetParts.length - 1];
    const text =
      shouldPreserveBoundary && last?.kind === part.kind && !part.text.startsWith('\n\n')
        ? `\n\n${part.text}`
        : part.text;

    appendAssistantTextPart(targetParts, part.kind, text);
    shouldPreserveBoundary = false;
  }
}

export function applyToolResultToParts(
  parts: ChatMessagePart[] | undefined,
  toolCallId: string | undefined,
  result: unknown,
  status: ToolCall['status'],
): void {
  if (!parts || !toolCallId) {
    return;
  }

  const part = parts.find(
    (item): item is Extract<ChatMessagePart, { kind: 'toolCall' }> =>
      item.kind === 'toolCall' && item.toolCall.id === toolCallId,
  );
  if (!part) {
    return;
  }

  part.toolCall.result = result;
  part.toolCall.status = status;
}

export function assistantStatus(message: MessageLike): ChatMessage['status'] {
  if (message.stopReason === 'aborted') {
    return 'interrupted';
  }

  if (message.stopReason === 'error' || message.errorMessage) {
    return 'error';
  }

  return 'completed';
}

export function systemMessage(id: string, createdAt: string, markdown: string): ChatMessage {
  return {
    id,
    role: 'system',
    createdAt,
    markdown,
    status: 'completed',
  };
}

export { toolCallsFromMessageParts };
