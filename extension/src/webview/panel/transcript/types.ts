import type { ComponentChildren } from 'preact';

import type { ToolCall } from '../../../shared/protocol';
import type { TranscriptContextMenuType } from '../chat-prefs';

export type TranscriptContextMenuHandler = (
  type: TranscriptContextMenuType,
  rawData: string,
  e: MouseEvent,
) => void;

export type RenderToolCall = (
  toolCall: ToolCall,
  onContextMenu: TranscriptContextMenuHandler,
) => ComponentChildren;
