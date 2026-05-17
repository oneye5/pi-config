import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sessionStateActions,
  sessionStateReducer,
} from '../src/host/store/session-state-slice';

function reduce(...actions: ReturnType<(typeof sessionStateActions)[keyof typeof sessionStateActions]>[]) {
  let state = sessionStateReducer(undefined, { type: '@@init' });
  for (const action of actions) {
    state = sessionStateReducer(state, action);
  }
  return state;
}

const inputA = {
  id: 'input-a',
  kind: 'filesystemPathRef' as const,
  path: '/workspace/a.ts',
  name: 'a.ts',
  source: 'picker' as const,
};

const inputB = {
  id: 'input-b',
  kind: 'filesystemPathRef' as const,
  path: '/workspace/b.ts',
  name: 'b.ts',
  source: 'drop' as const,
};

const summary = {
  runId: 'run-1',
  status: 'open' as const,
  scored: false,
};

const factors = {
  promptFamily: 'default',
  promptHash: 'prompt-hash',
  harnessPromptHash: null,
  customPromptHash: null,
  appendSystemPromptHash: null,
  promptGuidelineHashes: ['guideline'],
  contextFiles: [{ path: '/workspace/a.ts', hash: 'ctx-hash' }],
  selectedToolIds: ['bash'],
  toolSnippetHashes: [{ toolId: 'bash', hash: 'tool-hash' }],
  toolSetHash: 'tool-set-hash',
  skills: [{
    name: 'review',
    contentHash: 'content-hash',
    sourceHash: 'source-hash',
    disableModelInvocation: false,
    lastModifiedAt: '2026-01-01T00:00:00.000Z',
  }],
  skillSetHash: 'skill-set-hash',
  activeExtensions: ['subagent'],
};

test('sessionStateReducer removes pending composer inputs incrementally and drops empty session buckets', () => {
  const populated = reduce(
    sessionStateActions.addPendingComposerInput({ sessionPath: '/session/a', input: inputA }),
    sessionStateActions.addPendingComposerInput({ sessionPath: '/session/a', input: inputB }),
  );

  const afterFirstRemoval = sessionStateReducer(
    populated,
    sessionStateActions.removePendingComposerInput({ sessionPath: '/session/a', inputId: inputA.id }),
  );
  assert.deepEqual(afterFirstRemoval.pendingComposerInputsBySession['/session/a'], [inputB]);

  const afterSecondRemoval = sessionStateReducer(
    afterFirstRemoval,
    sessionStateActions.removePendingComposerInput({ sessionPath: '/session/a', inputId: inputB.id }),
  );
  assert.equal(afterSecondRemoval.pendingComposerInputsBySession['/session/a'], undefined);

  const untouched = sessionStateReducer(
    afterSecondRemoval,
    sessionStateActions.removePendingComposerInput({ sessionPath: '/session/missing', inputId: 'missing' }),
  );
  assert.equal(untouched.pendingComposerInputsBySession['/session/missing'], undefined);
});

test('sessionStateReducer replaces pending inputs and clears them explicitly', () => {
  const replaced = reduce(
    sessionStateActions.setPendingComposerInputs({ sessionPath: '/session/a', inputs: [inputA, inputB] }),
  );
  assert.deepEqual(replaced.pendingComposerInputsBySession['/session/a'], [inputA, inputB]);

  const cleared = sessionStateReducer(
    replaced,
    sessionStateActions.clearPendingComposerInputs('/session/a'),
  );
  assert.equal(cleared.pendingComposerInputsBySession['/session/a'], undefined);
});

test('sessionStateReducer replaceSessionPath is a no-op for identical paths and merges session-scoped state otherwise', () => {
  const initial = reduce(
    sessionStateActions.addPendingComposerInput({ sessionPath: '/session/old', input: inputA }),
    sessionStateActions.addPendingComposerInput({ sessionPath: '/session/new', input: inputB }),
    sessionStateActions.setActiveRunSummary({ sessionPath: '/session/old', summary }),
    sessionStateActions.setAnalyticsFactors({ sessionPath: '/session/old', factors }),
  );

  const noOp = sessionStateReducer(
    initial,
    sessionStateActions.replaceSessionPath({ oldPath: '/session/old', newPath: '/session/old' }),
  );
  assert.deepEqual(noOp, initial);

  const migrated = sessionStateReducer(
    initial,
    sessionStateActions.replaceSessionPath({ oldPath: '/session/old', newPath: '/session/new' }),
  );
  assert.deepEqual(migrated.pendingComposerInputsBySession['/session/new'], [inputB, inputA]);
  assert.equal(migrated.pendingComposerInputsBySession['/session/old'], undefined);
  assert.deepEqual(migrated.activeRunSummaryBySession['/session/new'], summary);
  assert.equal(migrated.activeRunSummaryBySession['/session/old'], undefined);
  assert.deepEqual(migrated.analyticsFactorsBySession['/session/new'], factors);
  assert.equal(migrated.analyticsFactorsBySession['/session/old'], undefined);
});

test('sessionStateReducer stores and removes active run summaries and analytics factors', () => {
  const withState = reduce(
    sessionStateActions.setActiveRunSummary({ sessionPath: '/session/a', summary }),
    sessionStateActions.setAnalyticsFactors({ sessionPath: '/session/a', factors }),
  );
  assert.deepEqual(withState.activeRunSummaryBySession['/session/a'], summary);
  assert.deepEqual(withState.analyticsFactorsBySession['/session/a'], factors);

  const withoutState = reduce(
    sessionStateActions.setActiveRunSummary({ sessionPath: '/session/a', summary }),
    sessionStateActions.setAnalyticsFactors({ sessionPath: '/session/a', factors }),
    sessionStateActions.setActiveRunSummary({ sessionPath: '/session/a', summary: null }),
    sessionStateActions.setAnalyticsFactors({ sessionPath: '/session/a', factors: null }),
  );
  assert.equal(withoutState.activeRunSummaryBySession['/session/a'], undefined);
  assert.equal(withoutState.analyticsFactorsBySession['/session/a'], undefined);
});

test('sessionStateReducer clearSessionState removes all slices for the target session only', () => {
  const initial = reduce(
    sessionStateActions.addPendingComposerInput({ sessionPath: '/session/a', input: inputA }),
    sessionStateActions.setActiveRunSummary({ sessionPath: '/session/a', summary }),
    sessionStateActions.setAnalyticsFactors({ sessionPath: '/session/a', factors }),
    sessionStateActions.addPendingComposerInput({ sessionPath: '/session/b', input: inputB }),
  );

  const cleared = sessionStateReducer(initial, sessionStateActions.clearSessionState('/session/a'));
  assert.equal(cleared.pendingComposerInputsBySession['/session/a'], undefined);
  assert.equal(cleared.activeRunSummaryBySession['/session/a'], undefined);
  assert.equal(cleared.analyticsFactorsBySession['/session/a'], undefined);
  assert.deepEqual(cleared.pendingComposerInputsBySession['/session/b'], [inputB]);
});
