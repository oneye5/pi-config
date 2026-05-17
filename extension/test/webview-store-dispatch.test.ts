import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  sessionsSig,
  activeSessionPathSig,
  openTabPathsSig,
  runningSessionPathsSig,
  unreadFinishedSessionPathsSig,
  prefsSig,
  globalUiSig,
  hostMetaSig,
  getSessionStore,
  disposeAllSessionStores,
  applyHostMessage,
  setPostMessage,
} from '../src/webview/panel/store';
import type { HostToWebviewMessage, ViewState } from '../src/shared/protocol';
import { DEFAULT_CHAT_PREFS, EMPTY_TRANSCRIPT_WINDOW } from '../src/shared/protocol';

// ── Fixtures ──

function makeViewState(overrides: Partial<ViewState> = {}): ViewState {
  return {
    sessions: [{ path: '/s/a', name: 'A', cwd: '/', modifiedAt: '', messageCount: 1 }],
    openTabPaths: ['/s/a'],
    runningSessionPaths: [],
    unreadFinishedSessionPaths: [],
    activeSession: { path: '/s/a', name: 'A', cwd: '/', modifiedAt: '', messageCount: 1 },
    transcript: [
      { id: 'msg-1', role: 'user', createdAt: '', markdown: 'hi', status: 'completed' },
    ] as any,
    transcriptWindow: { ...EMPTY_TRANSCRIPT_WINDOW },
    pendingComposerInputs: [],
    activeRunSummary: null,
    runSummariesBySession: {},
    busy: false,
    notice: null,
    backendReady: true,
    workspaceCwd: '/',
    systemPrompts: [],
    modelSettings: null,
    availableModels: [],
    contextUsage: null,
    prefs: { ...DEFAULT_CHAT_PREFS },
    availableExtensions: [],
    fileChanges: [],
    pruningResult: null,
    pruningSettings: { mode: 'auto' as const, skillCeiling: 5, toolCeiling: 5 },
    ...overrides,
  };
}

function stateMessage(state: ViewState, revision = 1, hostInstanceId = 'host-1'): HostToWebviewMessage {
  return { type: 'state', hostInstanceId, revision, state } as any;
}

// ── Setup ──

const posted: any[] = [];

beforeEach(() => {
  // Reset signals
  sessionsSig.value = [];
  activeSessionPathSig.value = null;
  openTabPathsSig.value = [];
  runningSessionPathsSig.value = [];
  unreadFinishedSessionPathsSig.value = [];
  prefsSig.value = { ...DEFAULT_CHAT_PREFS };
  globalUiSig.value = { contextMenu: null, outcomeDialog: false, notice: null };
  hostMetaSig.value = { instanceId: '', revision: 0, awaitingSnapshot: false };
  disposeAllSessionStores();
  posted.length = 0;
  setPostMessage((msg) => posted.push(msg));
});

// ── Tests ──

test('applyHostMessage state: sets global signals', () => {
  const state = makeViewState();
  applyHostMessage(stateMessage(state));

  assert.equal(sessionsSig.value.length, 1);
  assert.equal(activeSessionPathSig.value, '/s/a');
  assert.deepEqual(openTabPathsSig.value, ['/s/a']);
  assert.equal(hostMetaSig.value.instanceId, 'host-1');
  assert.equal(hostMetaSig.value.revision, 1);
  assert.equal(hostMetaSig.value.awaitingSnapshot, false);
});

test('applyHostMessage state: seeds session store', () => {
  const state = makeViewState();
  applyHostMessage(stateMessage(state));

  const store = getSessionStore('/s/a');
  assert.equal(store.transcriptSig.value!.length, 1);
  assert.equal(store.busySig.value, false);
});

test('applyHostMessage patch: updates revision', () => {
  applyHostMessage(stateMessage(makeViewState(), 1, 'host-1'));

  applyHostMessage({
    type: 'patch',
    hostInstanceId: 'host-1',
    revision: 2,
    op: { kind: 'messageDelta', messageId: 'msg-1', delta: 'hello' },
  } as any);

  assert.equal(hostMetaSig.value.revision, 2);
});

test('applyHostMessage patch: requests snapshot on gap', () => {
  applyHostMessage(stateMessage(makeViewState(), 1, 'host-1'));

  // Skip revision 2 → gap
  applyHostMessage({
    type: 'patch',
    hostInstanceId: 'host-1',
    revision: 3,
    op: { kind: 'messageDelta', messageId: 'msg-1', delta: 'hello' },
  } as any);

  assert.ok(posted.some((m) => m.type === 'requestSnapshot'));
  assert.equal(hostMetaSig.value.awaitingSnapshot, true);
});

test('applyHostMessage patch: ignores stale revision', () => {
  applyHostMessage(stateMessage(makeViewState(), 5, 'host-1'));

  applyHostMessage({
    type: 'patch',
    hostInstanceId: 'host-1',
    revision: 3,
    op: { kind: 'messageDelta', messageId: 'msg-1', delta: 'hello' },
  } as any);

  assert.equal(hostMetaSig.value.revision, 5);
});

test('applyHostMessage patch: host instance change requests snapshot', () => {
  applyHostMessage(stateMessage(makeViewState(), 1, 'host-1'));

  applyHostMessage({
    type: 'patch',
    hostInstanceId: 'host-2',
    revision: 1,
    op: { kind: 'messageDelta', messageId: 'msg-1', delta: 'hello' },
  } as any);

  assert.ok(posted.some((m) => m.type === 'requestSnapshot'));
  assert.equal(hostMetaSig.value.instanceId, 'host-2');
});

test('applyHostMessage state: host instance change disposes all stores', () => {
  applyHostMessage(stateMessage(makeViewState(), 1, 'host-1'));
  const store1 = getSessionStore('/s/a');
  assert.equal(store1.transcriptSig.value!.length, 1);

  // New host instance
  applyHostMessage(stateMessage(makeViewState({ openTabPaths: ['/s/b'], activeSession: { path: '/s/b', name: 'B', cwd: '/', modifiedAt: '', messageCount: 0 } }), 1, 'host-2'));
  assert.equal(activeSessionPathSig.value, '/s/b');
});

test('applyHostMessage sendRejected: queues draft for active session', () => {
  applyHostMessage(stateMessage(makeViewState(), 1, 'host-1'));

  applyHostMessage({ type: 'sendRejected', sessionPath: '/s/a', text: 'rejected text' } as any);

  const store = getSessionStore('/s/a');
  assert.equal(store.draftRestoreSig.value?.text, 'rejected text');
});

test('applyHostMessage sendRejected: queues draft for non-active and restores later', () => {
  applyHostMessage(stateMessage(makeViewState(), 1, 'host-1'));

  // Send rejected for a different session
  applyHostMessage({ type: 'sendRejected', sessionPath: '/s/other', text: 'deferred' } as any);

  // Now switch to that session
  applyHostMessage(stateMessage(makeViewState({
    openTabPaths: ['/s/a', '/s/other'],
    activeSession: { path: '/s/other', name: 'Other', cwd: '/', modifiedAt: '', messageCount: 0 },
  }), 2, 'host-1'));

  const store = getSessionStore('/s/other');
  assert.equal(store.draftRestoreSig.value?.text, 'deferred');
});

test('applyHostMessage state: session change clears transient UI', () => {
  applyHostMessage(stateMessage(makeViewState(), 1, 'host-1'));
  const store = getSessionStore('/s/a');
  store.editingIdSig.value = 'editing-something';

  // Switch session
  applyHostMessage(stateMessage(makeViewState({
    activeSession: { path: '/s/b', name: 'B', cwd: '/', modifiedAt: '', messageCount: 0 },
    openTabPaths: ['/s/a', '/s/b'],
  }), 2, 'host-1'));

  assert.equal(store.editingIdSig.value, null);
});

test('applyHostMessage state: pending path migration', () => {
  applyHostMessage(stateMessage(makeViewState({
    openTabPaths: ['__pending__:123'],
    activeSession: { path: '__pending__:123', name: 'Pending', cwd: '/', modifiedAt: '', messageCount: 0 },
  }), 1, 'host-1'));

  const pendingStore = getSessionStore('__pending__:123');
  pendingStore.editingIdSig.value = 'editing-in-pending';

  // Host resolves pending → real path (same index)
  applyHostMessage(stateMessage(makeViewState({
    openTabPaths: ['/s/real'],
    activeSession: { path: '/s/real', name: 'Real', cwd: '/', modifiedAt: '', messageCount: 0 },
  }), 2, 'host-1'));

  const realStore = getSessionStore('/s/real');
  // The migrated store should have the editing state from the pending store
  assert.equal(realStore.editingIdSig.value, 'editing-in-pending');
});
