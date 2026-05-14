import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { DEFAULT_CHAT_PREFS, type ChatPrefs } from '../../shared/protocol';

interface UiState {
  notice: string | null;
  backendReady: boolean;
  prefs: ChatPrefs;
}

const uiSlice = createSlice({
  name: 'ui',
  initialState: { notice: null, backendReady: false, prefs: DEFAULT_CHAT_PREFS } as UiState,
  reducers: {
    setNotice(state, action: PayloadAction<string | null>) {
      state.notice = action.payload;
    },
    setBackendReady(state, action: PayloadAction<boolean>) {
      state.backendReady = action.payload;
    },
    setPrefs(state, action: PayloadAction<Partial<ChatPrefs>>) {
      state.prefs = { ...state.prefs, ...action.payload };
    },
  },
});

export const uiReducer = uiSlice.reducer;
export const uiActions = uiSlice.actions;
