import type { ChatMessage, UserContentPart } from '../../../shared/protocol';

export {
  appendAssistantTextPart,
  assistantPartsFromMessage,
  mergeAssistantParts,
  reasoningFromMessageParts,
  textFromMessageParts,
  toolCallsFromMessageParts,
  upsertAssistantToolPart,
} from '../../../shared/chat-message-parts';

export function getRenderableUserParts(
  message: Pick<ChatMessage, 'role' | 'markdown' | 'userParts'>,
): UserContentPart[] | undefined {
  if (message.role !== 'user') {
    return undefined;
  }

  if (message.userParts && message.userParts.length > 0) {
    return message.userParts;
  }

  if (!message.markdown) {
    return undefined;
  }

  return [{ kind: 'text', text: message.markdown }];
}

export function messageHasUserImages(message: Pick<ChatMessage, 'role' | 'userParts'>): boolean {
  if (message.role !== 'user') {
    return false;
  }

  return message.userParts?.some((part) => part.kind === 'image') ?? false;
}

export function userImageSrc(part: Extract<UserContentPart, { kind: 'image' }>): string {
  return `data:${part.mimeType};base64,${part.dataBase64}`;
}
