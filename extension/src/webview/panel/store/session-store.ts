import { signal } from '@preact/signals';

import type {
  ActiveRunSummary,
  ChatMessage,
  ChatMessagePart,
  ComposerInput,
  ContextWindowUsage,
  FileChangeEntry,
  PruningResult,
  SystemPromptEntry,
  TranscriptWindow,
} from '../../../shared/protocol';
import { EMPTY_TRANSCRIPT_WINDOW } from '../../../shared/protocol';
import type { Overlay } from '../overlay';
import { emptyOverlay } from '../overlay';

export interface SessionStore {
  path: string;
  transcriptSig: ReturnType<typeof signal<ChatMessage[]>>;
  transcriptWindowSig: ReturnType<typeof signal<TranscriptWindow>>;
  busySig: ReturnType<typeof signal<boolean>>;
  systemPromptsSig: ReturnType<typeof signal<SystemPromptEntry[]>>;
  contextUsageSig: ReturnType<typeof signal<ContextWindowUsage | null>>;
  fileChangesSig: ReturnType<typeof signal<FileChangeEntry[]>>;
  pruningResultSig: ReturnType<typeof signal<PruningResult | null>>;
  pendingComposerInputsSig: ReturnType<typeof signal<ComposerInput[]>>;
  activeRunSummarySig: ReturnType<typeof signal<ActiveRunSummary | null>>;

  /**
   * Per-message streaming parts. Outer map changes only when an entry is
   * created or deleted. Inner signals change on each smoother commit so only
   * the target MessageItem re-renders.
   */
  streamingMapSig: ReturnType<typeof signal<Map<string, ReturnType<typeof signal<ChatMessagePart[]>>>>>;

  /** Legacy overlay compat — will be removed in Phase 8. */
  overlaySig: ReturnType<typeof signal<Overlay>>;

  editingIdSig: ReturnType<typeof signal<string | null>>;
  draftRestoreSig: ReturnType<typeof signal<{ text: string; nonce: number } | null>>;

  /** Token rate state */
  tokenRateSig: ReturnType<typeof signal<{ tokensPerSecond: number | null; windowSeconds: number }>>;
  tokenRateSamples: { tokens: number; timestamp: number }[];
}

const sessionStores = new Map<string, SessionStore>();

export function createSessionStore(path: string): SessionStore {
  return {
    path,
    transcriptSig: signal<ChatMessage[]>([]),
    transcriptWindowSig: signal<TranscriptWindow>({ ...EMPTY_TRANSCRIPT_WINDOW }),
    busySig: signal(false),
    systemPromptsSig: signal<SystemPromptEntry[]>([]),
    contextUsageSig: signal<ContextWindowUsage | null>(null),
    fileChangesSig: signal<FileChangeEntry[]>([]),
    pruningResultSig: signal<PruningResult | null>(null),
    pendingComposerInputsSig: signal<ComposerInput[]>([]),
    activeRunSummarySig: signal<ActiveRunSummary | null>(null),
    streamingMapSig: signal(new Map()),
    overlaySig: signal<Overlay>(emptyOverlay()),
    editingIdSig: signal<string | null>(null),
    draftRestoreSig: signal<{ text: string; nonce: number } | null>(null),
    tokenRateSig: signal({ tokensPerSecond: null as number | null, windowSeconds: 10 }),
    tokenRateSamples: [],
  };
}

export function getSessionStore(path: string): SessionStore {
  let store = sessionStores.get(path);
  if (!store) {
    store = createSessionStore(path);
    sessionStores.set(path, store);
  }
  return store;
}

export function disposeSessionStore(path: string): void {
  const store = sessionStores.get(path);
  if (!store) return;
  // Clear streaming signals
  const map = store.streamingMapSig.value;
  if (map) map.clear();
  store.streamingMapSig.value = new Map();
  sessionStores.delete(path);
}

export function migrateSessionStore(oldPath: string, newPath: string): void {
  const store = sessionStores.get(oldPath);
  if (!store) return;
  sessionStores.delete(oldPath);
  store.path = newPath;
  sessionStores.set(newPath, store);
}

export function disposeAllSessionStores(): void {
  for (const [path] of sessionStores) {
    disposeSessionStore(path);
  }
}

/** Expose for testing */
export function _getStoreMap(): Map<string, SessionStore> {
  return sessionStores;
}
