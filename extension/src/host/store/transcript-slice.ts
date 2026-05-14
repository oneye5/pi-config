import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type {
  ChatMessage,
  SystemPromptEntry,
  ToolCall,
  TranscriptWindow,
  UserContentPart,
} from '../../shared/protocol';
import { TRANSCRIPT_WINDOW_BUDGETS } from '../../shared/transcript-window';
import {
  buildFullTranscriptWindow,
  cullTranscriptWindowAroundActiveTurn,
  normalizeTranscriptWindow,
  trimTranscriptWindowTail,
  withDecrementedWindowCounts,
  withIncrementedWindowCounts,
} from '../transcript-window';
import {
  appendAssistantTextPart,
  clearSessionAliases,
  markdownFromUserParts,
  mergeAssistantToolCallsPreservingResolvedState,
  mergeContinuationToolCalls,
  resolveAlias,
  upsertAssistantToolCall,
  withAssistantParts,
  type TranscriptState,
} from './transcript-helpers';

function ensureSessionWindow(state: TranscriptState, sessionPath: string): TranscriptWindow {
  const existing = state.windowBySession[sessionPath];
  if (existing) {
    return existing;
  }

  const built = buildFullTranscriptWindow(state.bySession[sessionPath] ?? []);
  state.windowBySession[sessionPath] = built;
  return built;
}

function enforceLoadedWindowBudget(state: TranscriptState, sessionPath: string): void {
  const transcript = state.bySession[sessionPath];
  if (!transcript || transcript.length === 0) {
    return;
  }

  const transcriptWindow = ensureSessionWindow(state, sessionPath);
  const activeTurnMessageId = state.currentTurnBySession[sessionPath]?.firstMessageId;
  const culled = cullTranscriptWindowAroundActiveTurn({
    transcript,
    transcriptWindow,
    activeTurnMessageId,
    maxLoadedCount: TRANSCRIPT_WINDOW_BUDGETS.maxLoadedCount,
  });

  state.bySession[sessionPath] = culled.transcript;
  state.windowBySession[sessionPath] = culled.transcriptWindow;
}

const transcriptSlice = createSlice({
  name: 'transcript',
  initialState: {
    bySession: {},
    systemPromptsBySession: {},
    windowBySession: {},
    messageIdAlias: {},
    currentTurnBySession: {},
  } as TranscriptState,
  reducers: {
    setTranscript(
      state,
      action: PayloadAction<{
        sessionPath: string;
        transcript: ChatMessage[];
        transcriptWindow?: TranscriptWindow;
        systemPrompts?: SystemPromptEntry[];
        preserveCurrentTurn?: boolean;
        preserveAliases?: boolean;
      }>,
    ) {
      const {
        sessionPath,
        transcript,
        transcriptWindow,
        systemPrompts,
        preserveCurrentTurn,
        preserveAliases,
      } = action.payload;

      if (!preserveAliases) {
        clearSessionAliases(state, sessionPath);
      }

      state.bySession[sessionPath] = transcript;
      state.windowBySession[sessionPath] = normalizeTranscriptWindow(transcript, transcriptWindow);

      if (systemPrompts !== undefined || !preserveCurrentTurn) {
        state.systemPromptsBySession[sessionPath] = systemPrompts ?? [];
      }

      if (!preserveCurrentTurn) {
        delete state.currentTurnBySession[sessionPath];
      }
    },
    setTranscriptWindowMetadata(
      state,
      action: PayloadAction<{ sessionPath: string; transcriptWindow: TranscriptWindow }>,
    ) {
      const { sessionPath, transcriptWindow } = action.payload;
      const transcript = state.bySession[sessionPath] ?? [];
      state.windowBySession[sessionPath] = normalizeTranscriptWindow(transcript, transcriptWindow);
    },
    trimTranscriptForInactivity(
      state,
      action: PayloadAction<{ sessionPath: string; keepTailCount: number; dropAll?: boolean }>,
    ) {
      const { sessionPath, keepTailCount, dropAll } = action.payload;
      const transcript = state.bySession[sessionPath] ?? [];
      const transcriptWindow = ensureSessionWindow(state, sessionPath);

      if (dropAll) {
        clearSessionAliases(state, sessionPath);
        state.bySession[sessionPath] = [];
        state.windowBySession[sessionPath] = {
          ...transcriptWindow,
          loadedStart: transcriptWindow.totalCount,
          loadedEnd: transcriptWindow.totalCount,
          hasOlder: transcriptWindow.totalCount > 0,
          hasNewer: false,
          isPartial: transcriptWindow.totalCount > 0,
        };
        delete state.currentTurnBySession[sessionPath];
        return;
      }

      const trimmed = trimTranscriptWindowTail(transcript, transcriptWindow, keepTailCount);
      state.bySession[sessionPath] = trimmed.transcript;
      state.windowBySession[sessionPath] = trimmed.transcriptWindow;
    },
    clearTranscript(state, action: PayloadAction<string>) {
      clearSessionAliases(state, action.payload);
      delete state.bySession[action.payload];
      delete state.systemPromptsBySession[action.payload];
      delete state.windowBySession[action.payload];
      delete state.currentTurnBySession[action.payload];
    },
    clearSessionState(state, action: PayloadAction<string>) {
      clearSessionAliases(state, action.payload);
      delete state.bySession[action.payload];
      delete state.systemPromptsBySession[action.payload];
      delete state.windowBySession[action.payload];
      delete state.currentTurnBySession[action.payload];
    },
    ensureAssistantMessage(
      state,
      action: PayloadAction<{
        sessionPath: string;
        messageId: string;
        requestId?: string;
        modelId?: string;
        thinkingLevel?: ChatMessage['thinkingLevel'];
      }>,
    ) {
      const { sessionPath, messageId, requestId, modelId, thinkingLevel } = action.payload;
      const list = (state.bySession[sessionPath] ??= []);
      const existing = list.find((m) => m.id === messageId);
      if (existing) {
        if (modelId) {
          existing.modelId = modelId;
        }
        if (thinkingLevel) {
          existing.thinkingLevel = thinkingLevel;
        }
        return;
      }

      if (requestId) {
        const currentTurn = state.currentTurnBySession[sessionPath];
        if (currentTurn?.requestId === requestId) {
          state.messageIdAlias[messageId] = currentTurn.firstMessageId;
          const canonical = list.find((message) => message.id === currentTurn.firstMessageId);
          if (canonical) {
            if (canonical.markdown) {
              canonical.markdown += '\n\n';
            }
            if (canonical.thinking) {
              canonical.thinking += '\n\n';
            }
            if (modelId) {
              canonical.modelId = modelId;
            }
            if (thinkingLevel) {
              canonical.thinkingLevel = thinkingLevel;
            }
          }
          return;
        }
        state.currentTurnBySession[sessionPath] = { requestId, firstMessageId: messageId };
      }

      list.push({
        id: messageId,
        role: 'assistant',
        createdAt: new Date().toISOString(),
        markdown: '',
        modelId,
        thinkingLevel,
        parts: [],
        status: 'streaming',
        toolCalls: [],
      });

      state.windowBySession[sessionPath] = withIncrementedWindowCounts(state.windowBySession[sessionPath]);
      enforceLoadedWindowBudget(state, sessionPath);
    },
    appendDelta(
      state,
      action: PayloadAction<{ sessionPath: string; messageId: string; delta: string }>,
    ) {
      const { sessionPath, delta } = action.payload;
      const messageId = resolveAlias(state.messageIdAlias, action.payload.messageId);
      const message = state.bySession[sessionPath]?.find((item) => item.id === messageId);
      if (message) {
        appendAssistantTextPart(message, 'text', delta);
        message.status = 'streaming';
      }
    },
    appendThinking(
      state,
      action: PayloadAction<{ sessionPath: string; messageId: string; thinking: string }>,
    ) {
      const { sessionPath, thinking } = action.payload;
      const messageId = resolveAlias(state.messageIdAlias, action.payload.messageId);
      const message = state.bySession[sessionPath]?.find((item) => item.id === messageId);
      if (message) {
        appendAssistantTextPart(message, 'reasoning', thinking);
        message.status = 'streaming';
      }
    },
    upsertToolCall(
      state,
      action: PayloadAction<{ sessionPath: string; messageId: string; toolCall: ToolCall }>,
    ) {
      const { sessionPath, toolCall } = action.payload;
      const messageId = resolveAlias(state.messageIdAlias, action.payload.messageId);
      const message = state.bySession[sessionPath]?.find((item) => item.id === messageId);
      if (message) {
        upsertAssistantToolCall(message, toolCall);
      }
    },
    upsertMessage(
      state,
      action: PayloadAction<{ sessionPath: string; message: ChatMessage }>,
    ) {
      const { sessionPath, message } = action.payload;
      const normalizedMessage = withAssistantParts(message);
      const list = (state.bySession[sessionPath] ??= []);
      const canonicalId = resolveAlias(state.messageIdAlias, normalizedMessage.id);

      if (canonicalId !== normalizedMessage.id) {
        const canonical = list.find((item) => item.id === canonicalId);
        if (canonical) {
          canonical.status = normalizedMessage.status;
          if (normalizedMessage.modelId) {
            canonical.modelId = normalizedMessage.modelId;
          }
          if (normalizedMessage.thinkingLevel) {
            canonical.thinkingLevel = normalizedMessage.thinkingLevel;
          }
          if (normalizedMessage.durationMs !== undefined) {
            canonical.durationMs = (canonical.durationMs ?? 0) + normalizedMessage.durationMs;
          }
          mergeContinuationToolCalls(canonical, normalizedMessage);
        }
        return;
      }

      const index = list.findIndex((item) => item.id === normalizedMessage.id);
      if (index === -1) {
        list.push(normalizedMessage);
        state.windowBySession[sessionPath] = withIncrementedWindowCounts(state.windowBySession[sessionPath]);
        if (normalizedMessage.role === 'user') {
          state.windowBySession[sessionPath].hasUserMessages = true;
        }
        enforceLoadedWindowBudget(state, sessionPath);
        return;
      }

      const previousMessage = list[index];
      if (previousMessage) {
        mergeAssistantToolCallsPreservingResolvedState(normalizedMessage, previousMessage);
      }
      list[index] = normalizedMessage;
    },
    setMessageStatus(
      state,
      action: PayloadAction<{ sessionPath: string; messageId: string; status: ChatMessage['status'] }>,
    ) {
      const { sessionPath, status } = action.payload;
      const messageId = resolveAlias(state.messageIdAlias, action.payload.messageId);
      const message = state.bySession[sessionPath]?.find((item) => item.id === messageId);
      if (message) {
        message.status = status;
      }
    },
    appendLocalUserMessage(
      state,
      action: PayloadAction<{
        sessionPath: string;
        id: string;
        text: string;
        userParts?: UserContentPart[];
      }>,
    ) {
      const { sessionPath, id, text, userParts } = action.payload;
      const list = (state.bySession[sessionPath] ??= []);
      list.push({
        id,
        role: 'user',
        createdAt: new Date().toISOString(),
        markdown: markdownFromUserParts(userParts, text),
        userParts,
        status: 'completed',
      });

      const nextWindow = withIncrementedWindowCounts(state.windowBySession[sessionPath]);
      nextWindow.hasUserMessages = true;
      state.windowBySession[sessionPath] = nextWindow;
      enforceLoadedWindowBudget(state, sessionPath);
    },
    removeMessage(
      state,
      action: PayloadAction<{ sessionPath: string; messageId: string }>,
    ) {
      const { sessionPath, messageId } = action.payload;
      const list = state.bySession[sessionPath];
      if (!list) {
        return;
      }

      const removedMessage = list.find((message) => message.id === messageId);
      state.bySession[sessionPath] = list.filter((message) => message.id !== messageId);
      const nextWindow = withDecrementedWindowCounts(state.windowBySession[sessionPath]);
      if (nextWindow) {
        const isFullyLoaded =
          !nextWindow.hasOlder
          && !nextWindow.hasNewer
          && nextWindow.loadedStart === 0
          && nextWindow.loadedEnd === nextWindow.totalCount;

        if (
          removedMessage?.role === 'user'
          && isFullyLoaded
          && !state.bySession[sessionPath].some((message) => message.role === 'user')
        ) {
          nextWindow.hasUserMessages = false;
        }

        state.windowBySession[sessionPath] = nextWindow;
      }
    },
  },
});

export const transcriptReducer = transcriptSlice.reducer;
export const transcriptActions = transcriptSlice.actions;
export type { TranscriptState } from './transcript-helpers';
