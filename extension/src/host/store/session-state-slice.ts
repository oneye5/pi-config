import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type {
  ActiveRunSummary,
  ComposerInput,
  SessionAnalyticsFactors,
} from '../../shared/protocol';

interface SessionStateViewState {
  pendingComposerInputsBySession: Record<string, ComposerInput[]>;
  activeRunSummaryBySession: Record<string, ActiveRunSummary | null>;
  analyticsFactorsBySession: Record<string, SessionAnalyticsFactors | null>;
}

const sessionStateSlice = createSlice({
  name: 'sessionState',
  initialState: {
    pendingComposerInputsBySession: {},
    activeRunSummaryBySession: {},
    analyticsFactorsBySession: {},
  } as SessionStateViewState,
  reducers: {
    addPendingComposerInput(
      state,
      action: PayloadAction<{ sessionPath: string; input: ComposerInput }>,
    ) {
      const list = (state.pendingComposerInputsBySession[action.payload.sessionPath] ??= []);
      list.push(action.payload.input);
    },
    setPendingComposerInputs(
      state,
      action: PayloadAction<{ sessionPath: string; inputs: ComposerInput[] }>,
    ) {
      state.pendingComposerInputsBySession[action.payload.sessionPath] = action.payload.inputs;
    },
    removePendingComposerInput(
      state,
      action: PayloadAction<{ sessionPath: string; inputId: string }>,
    ) {
      const list = state.pendingComposerInputsBySession[action.payload.sessionPath];
      if (!list) {
        return;
      }

      const nextInputs = list.filter((input) => input.id !== action.payload.inputId);
      if (nextInputs.length > 0) {
        state.pendingComposerInputsBySession[action.payload.sessionPath] = nextInputs;
        return;
      }

      delete state.pendingComposerInputsBySession[action.payload.sessionPath];
    },
    clearPendingComposerInputs(state, action: PayloadAction<string>) {
      delete state.pendingComposerInputsBySession[action.payload];
    },
    replaceSessionPath(
      state,
      action: PayloadAction<{ oldPath: string; newPath: string }>,
    ) {
      const { oldPath, newPath } = action.payload;
      if (oldPath === newPath) {
        return;
      }

      const oldInputs = state.pendingComposerInputsBySession[oldPath];
      if (oldInputs) {
        const existingInputs = state.pendingComposerInputsBySession[newPath] ?? [];
        state.pendingComposerInputsBySession[newPath] = [...existingInputs, ...oldInputs];
        delete state.pendingComposerInputsBySession[oldPath];
      }

      if (Object.prototype.hasOwnProperty.call(state.activeRunSummaryBySession, oldPath)) {
        state.activeRunSummaryBySession[newPath] = state.activeRunSummaryBySession[oldPath] ?? null;
        delete state.activeRunSummaryBySession[oldPath];
      }

      if (Object.prototype.hasOwnProperty.call(state.analyticsFactorsBySession, oldPath)) {
        state.analyticsFactorsBySession[newPath] = state.analyticsFactorsBySession[oldPath] ?? null;
        delete state.analyticsFactorsBySession[oldPath];
      }
    },
    setActiveRunSummary(
      state,
      action: PayloadAction<{ sessionPath: string; summary: ActiveRunSummary | null }>,
    ) {
      if (action.payload.summary === null) {
        delete state.activeRunSummaryBySession[action.payload.sessionPath];
        return;
      }

      state.activeRunSummaryBySession[action.payload.sessionPath] = action.payload.summary;
    },
    setAnalyticsFactors(
      state,
      action: PayloadAction<{ sessionPath: string; factors: SessionAnalyticsFactors | null }>,
    ) {
      if (action.payload.factors === null) {
        delete state.analyticsFactorsBySession[action.payload.sessionPath];
        return;
      }

      state.analyticsFactorsBySession[action.payload.sessionPath] = action.payload.factors;
    },
    clearSessionState(state, action: PayloadAction<string>) {
      delete state.pendingComposerInputsBySession[action.payload];
      delete state.activeRunSummaryBySession[action.payload];
      delete state.analyticsFactorsBySession[action.payload];
    },
  },
});

export const sessionStateReducer = sessionStateSlice.reducer;
export const sessionStateActions = sessionStateSlice.actions;
