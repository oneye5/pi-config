import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type {
  ContextWindowUsage,
  ModelInfo,
  ModelSettings,
  PruningSettings,
} from '../../shared/protocol';
import { DEFAULT_PRUNING_SETTINGS } from '../../shared/protocol';

interface SettingsState {
  modelSettings: ModelSettings | null;
  pruningSettings: PruningSettings;
  availableModelsBySession: Record<string, ModelInfo[]>;
  contextUsageBySession: Record<string, ContextWindowUsage | null>;
}

const EMPTY_AVAILABLE_MODELS: ModelInfo[] = [];

const settingsSlice = createSlice({
  name: 'settings',
  initialState: {
    modelSettings: null,
    pruningSettings: DEFAULT_PRUNING_SETTINGS,
    availableModelsBySession: {},
    contextUsageBySession: {},
  } as SettingsState,
  reducers: {
    setModelSettings(state, action: PayloadAction<ModelSettings>) {
      state.modelSettings = action.payload;
    },
    setPruningSettings(state, action: PayloadAction<PruningSettings>) {
      state.pruningSettings = action.payload;
    },
    setAvailableModels(
      state,
      action: PayloadAction<{ sessionPath: string; availableModels: ModelInfo[] }>,
    ) {
      const existing = state.availableModelsBySession[action.payload.sessionPath] ?? EMPTY_AVAILABLE_MODELS;
      if (action.payload.availableModels.length > 0 || existing.length === 0) {
        state.availableModelsBySession[action.payload.sessionPath] = action.payload.availableModels;
      }
    },
    clearAvailableModels(state, action: PayloadAction<string>) {
      delete state.availableModelsBySession[action.payload];
    },
    setModelAndAvailable(
      state,
      action: PayloadAction<{
        sessionPath: string;
        modelSettings: ModelSettings;
        availableModels: ModelInfo[];
      }>,
    ) {
      state.modelSettings = action.payload.modelSettings;
      const existing = state.availableModelsBySession[action.payload.sessionPath] ?? EMPTY_AVAILABLE_MODELS;
      if (action.payload.availableModels.length > 0 || existing.length === 0) {
        state.availableModelsBySession[action.payload.sessionPath] = action.payload.availableModels;
      }
    },
    setContextUsage(
      state,
      action: PayloadAction<{ sessionPath: string; contextUsage: ContextWindowUsage | null }>,
    ) {
      state.contextUsageBySession[action.payload.sessionPath] = action.payload.contextUsage;
    },
    clearContextUsage(state, action: PayloadAction<string>) {
      delete state.contextUsageBySession[action.payload];
    },
  },
});

export const settingsReducer = settingsSlice.reducer;
export const settingsActions = settingsSlice.actions;
