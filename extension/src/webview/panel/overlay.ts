import type { ChatMessagePart, PatchOp, ToolCall } from '../../shared/protocol';

export interface Overlay {
  partsByMessage: Map<string, ChatMessagePart[]>;
}

export function emptyOverlay(): Overlay {
  return { partsByMessage: new Map() };
}

function cloneToolCall(toolCall: ToolCall): ToolCall {
  return { ...toolCall };
}

function clonePart(part: ChatMessagePart): ChatMessagePart {
  if (part.kind === 'toolCall') {
    return { kind: 'toolCall', toolCall: cloneToolCall(part.toolCall) };
  }

  return { kind: part.kind, text: part.text };
}

/** Append text/reasoning to a parts array (mutates in place). Exported for per-message signal use. */
export function appendTextToParts(parts: ChatMessagePart[], kind: 'text' | 'reasoning', text: string): void {
  if (!text) {
    return;
  }

  const last = parts[parts.length - 1];
  if (last?.kind === kind) {
    last.text += text;
    return;
  }

  parts.push({ kind, text });
}

/** Upsert a tool call part by id (mutates in place). Exported for per-message signal use. */
export function upsertToolCallInParts(parts: ChatMessagePart[], toolCall: ToolCall): void {
  const nextToolCall = cloneToolCall(toolCall);
  const index = parts.findIndex(
    (part) => part.kind === 'toolCall' && part.toolCall.id === nextToolCall.id,
  );
  if (index === -1) {
    parts.push({ kind: 'toolCall', toolCall: nextToolCall });
    return;
  }

  parts[index] = { kind: 'toolCall', toolCall: nextToolCall };
}

// Internal aliases for backward compat within applyPatch
const appendTextPart = appendTextToParts;
const upsertToolCallPart = upsertToolCallInParts;

export function applyPatch(overlay: Overlay, op: PatchOp): Overlay {
  const next: Overlay = {
    partsByMessage: new Map(overlay.partsByMessage),
  };

  switch (op.kind) {
    case 'messageDelta': {
      const currentParts = next.partsByMessage.get(op.messageId) ?? [];
      const messageParts = currentParts.map(clonePart);
      appendTextPart(messageParts, 'text', op.delta);
      next.partsByMessage.set(op.messageId, messageParts);
      break;
    }
    case 'messageThinking': {
      const currentParts = next.partsByMessage.get(op.messageId) ?? [];
      const messageParts = currentParts.map(clonePart);
      appendTextPart(messageParts, 'reasoning', op.thinking);
      next.partsByMessage.set(op.messageId, messageParts);
      break;
    }
    case 'toolCall': {
      const currentParts = next.partsByMessage.get(op.messageId) ?? [];
      const messageParts = currentParts.map(clonePart);
      upsertToolCallPart(messageParts, op.toolCall);
      next.partsByMessage.set(op.messageId, messageParts);
      break;
    }
    case 'clearOverlay': {
      if (op.messageIds) {
        for (const id of op.messageIds) {
          next.partsByMessage.delete(id);
        }
      } else {
        next.partsByMessage.clear();
      }
      break;
    }
  }

  return next;
}
