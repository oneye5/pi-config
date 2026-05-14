export interface ToolResultContentPartLike {
  type?: string;
  text?: string;
}

export interface ToolResultLike {
  details?: unknown;
  content?: string | ToolResultContentPartLike[];
}

function textFromToolResultParts(parts: ToolResultContentPartLike[] | undefined): string {
  if (!parts) {
    return '';
  }

  return parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('');
}

export function formatToolResult(message: ToolResultLike): unknown {
  if (message.details !== undefined) {
    const hasContent =
      (typeof message.content === 'string' && message.content.length > 0)
      || (Array.isArray(message.content) && message.content.length > 0);

    if (hasContent) {
      return {
        content: message.content,
        details: message.details,
      };
    }

    return message.details;
  }

  if (Array.isArray(message.content)) {
    const text = textFromToolResultParts(message.content);
    return text || message.content;
  }

  return message.content ?? null;
}
