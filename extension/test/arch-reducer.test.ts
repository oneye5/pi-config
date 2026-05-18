import test from 'node:test';
import assert from 'node:assert/strict';

import { reducer, initialArchState, type ArchState } from '../src/host/core/reducer';
import type { Event } from '../src/host/core/events';

test('reducer: initial state has empty pending and sessions records', () => {
  assert.deepEqual(initialArchState.pending, {});
  assert.deepEqual(initialArchState.sessions, {});
});

test('reducer: unhandled event returns unchanged state with no effects', () => {
  const event: Event = {
    kind: 'SendResult',
    corrId: 'c1',
    sessionPath: '/a',
    ok: true,
  };

  const result = reducer(initialArchState, event);

  assert.deepEqual(result.state, initialArchState);
  assert.deepEqual(result.effects, []);
});

test('reducer: Interrupt command sets interruptInFlight and returns InterruptRpc effect', () => {
  const event: Event = {
    kind: 'Command',
    cmd: { kind: 'Interrupt', corrId: 'c1', sessionPath: '/session/a' },
  };

  const result = reducer(initialArchState, event);

  assert.equal(result.state.sessions['/session/a']?.interruptInFlight, true);
  assert.equal(result.effects.length, 1);
  assert.deepEqual(result.effects[0], {
    kind: 'InterruptRpc',
    corrId: 'c1',
    sessionPath: '/session/a',
  });
});

test('reducer: Interrupt does not affect other sessions', () => {
  const stateWithB: ArchState = {
    ...initialArchState,
    sessions: { '/b': { interruptInFlight: false } },
  };

  const event: Event = {
    kind: 'Command',
    cmd: { kind: 'Interrupt', corrId: 'c2', sessionPath: '/a' },
  };

  const result = reducer(stateWithB, event);

  assert.equal(result.state.sessions['/a']?.interruptInFlight, true);
  assert.equal(result.state.sessions['/b']?.interruptInFlight, false);
});

test('reducer: InterruptResult{ok:true} clears interruptInFlight with no effects', () => {
  const state: ArchState = {
    ...initialArchState,
    sessions: { '/a': { interruptInFlight: true } },
  };

  const event: Event = {
    kind: 'InterruptResult',
    corrId: 'c1',
    sessionPath: '/a',
    ok: true,
  };

  const result = reducer(state, event);

  assert.equal(result.state.sessions['/a']?.interruptInFlight, false);
  assert.deepEqual(result.effects, []);
});

test('reducer: InterruptResult{ok:false} clears flag and produces Log effect', () => {
  const state: ArchState = {
    ...initialArchState,
    sessions: { '/a': { interruptInFlight: true } },
  };

  const event: Event = {
    kind: 'InterruptResult',
    corrId: 'c1',
    sessionPath: '/a',
    ok: false,
    error: 'connection lost',
  };

  const result = reducer(state, event);

  assert.equal(result.state.sessions['/a']?.interruptInFlight, false);
  assert.equal(result.effects.length, 1);
  assert.equal(result.effects[0]?.kind, 'Log');
  if (result.effects[0]?.kind === 'Log') {
    assert.equal(result.effects[0].level, 'error');
    assert.match(result.effects[0].message, /Interrupt failed/);
    assert.deepEqual(result.effects[0].data, { error: 'connection lost' });
  }
});

test('reducer: non-Interrupt Command passes through unchanged', () => {
  const event: Event = {
    kind: 'Command',
    cmd: { kind: 'Send', corrId: 'c1', sessionPath: '/a', text: 'hello' },
  };

  const result = reducer(initialArchState, event);

  assert.deepEqual(result.state, initialArchState);
  assert.deepEqual(result.effects, []);
});
