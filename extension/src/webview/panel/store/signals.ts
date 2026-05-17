import { signal } from '@preact/signals';

import type {
  ChatPrefs,
  SessionSummary,
} from '../../../shared/protocol';
import { DEFAULT_CHAT_PREFS } from '../../../shared/protocol';

// ─── Global signals ──────────────────────────────────────────────────────────

export const sessionsSig = signal<SessionSummary[]>([]);

/** Host-committed active session path from the latest accepted snapshot. */
export const activeSessionPathSig = signal<string | null>(null);

/** Optional UI-requested target for pending tab-click affordances. */
export const requestedActiveSessionPathSig = signal<string | null>(null);

export const openTabPathsSig = signal<string[]>([]);
export const runningSessionPathsSig = signal<string[]>([]);
export const unreadFinishedSessionPathsSig = signal<string[]>([]);

export const prefsSig = signal<ChatPrefs>({ ...DEFAULT_CHAT_PREFS });

export const globalUiSig = signal<{
  contextMenu: { type: string; rawData: string; x: number; y: number } | null;
  outcomeDialog: boolean;
  notice: string | null;
}>({
  contextMenu: null,
  outcomeDialog: false,
  notice: null,
});

export const hostMetaSig = signal<{
  instanceId: string;
  revision: number;
  awaitingSnapshot: boolean;
}>({
  instanceId: '',
  revision: 0,
  awaitingSnapshot: false,
});
