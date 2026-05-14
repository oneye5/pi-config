import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSessionOpenedTranscript } from '../src/host/session-opened-transcript';
import type { ChatMessage, TranscriptWindow } from '../src/shared/protocol';

function userMessage(id: string, markdown: string): ChatMessage {
  return {
    id,
    role: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    markdown,
    status: 'completed',
  };
}

function assistantMessage(id: string, markdown: string, status: ChatMessage['status']): ChatMessage {
  return {
    id,
    role: 'assistant',
    createdAt: '2026-01-01T00:00:00.000Z',
    markdown,
    status,
  };
}

function window(overrides: Partial<TranscriptWindow> = {}): TranscriptWindow {
  return {
    totalCount: 2,
    loadedStart: 0,
    loadedEnd: 2,
    hasOlder: false,
    hasNewer: false,
    isPartial: false,
    hasUserMessages: true,
    ...overrides,
  };
}

test('busy session.opened keeps the local streaming transcript', () => {
  const localTranscript = [
    userMessage('user-1', 'Prompt'),
    assistantMessage('req-1:1', 'Partial reply', 'streaming'),
  ];
  const incomingTranscript = [userMessage('user-1', 'Prompt')];

  const result = resolveSessionOpenedTranscript({
    busy: true,
    localTranscript,
    incomingTranscript,
    incomingTranscriptWindow: window({ totalCount: 2, loadedEnd: 1, hasNewer: true, isPartial: true }),
  });

  assert.equal(result.preserveLocal, true);
  assert.deepEqual(result.transcript, localTranscript);
  assert.equal(result.transcriptWindow.loadedEnd, 2);
  assert.equal(result.transcriptWindow.hasNewer, true);
});

test('busy session.opened keeps optimistic local transcript rows when not yet persisted', () => {
  const localTranscript = [
    userMessage('user-1', 'Prompt'),
    userMessage('local:send:1', 'Prompt with attachment'),
  ];

  const result = resolveSessionOpenedTranscript({
    busy: true,
    localTranscript,
    incomingTranscript: [userMessage('user-1', 'Prompt')],
    incomingTranscriptWindow: window({ totalCount: 2, loadedEnd: 1, hasNewer: true, isPartial: true }),
  });

  assert.equal(result.preserveLocal, true);
  assert.deepEqual(result.transcript, localTranscript);
  assert.equal(result.transcriptWindow.loadedEnd, 2);
  assert.equal(result.transcriptWindow.hasNewer, true);
});

test('busy session.opened drops an optimistic local user row already persisted under another id', () => {
  const localTranscript = [
    userMessage('user-1', 'Prompt'),
    {
      ...userMessage('local:send:1', 'Prompt with attachment'),
      userParts: [{ kind: 'text' as const, text: 'Prompt with attachment' }],
    },
  ];
  const incomingTranscript = [
    userMessage('user-1', 'Prompt'),
    userMessage('user-2', 'Prompt with attachment'),
  ];

  const result = resolveSessionOpenedTranscript({
    busy: true,
    localTranscript,
    incomingTranscript,
    incomingTranscriptWindow: window({ totalCount: 2, loadedEnd: 2 }),
  });

  assert.equal(result.preserveLocal, true);
  assert.deepEqual(result.transcript, incomingTranscript);
  assert.equal(result.transcriptWindow.totalCount, 2);
  assert.equal(result.transcriptWindow.loadedEnd, 2);
});

test('busy session.opened keeps repeated optimistic user text when the current send is not persisted', () => {
  const localTranscript = [
    userMessage('user-1', 'Repeat'),
    assistantMessage('assistant-1', 'Previous answer', 'completed'),
    userMessage('local:send:1', 'Repeat'),
  ];
  const incomingTranscript = [
    userMessage('user-1', 'Repeat'),
    assistantMessage('assistant-1', 'Previous answer', 'completed'),
  ];

  const result = resolveSessionOpenedTranscript({
    busy: true,
    localTranscript,
    incomingTranscript,
    incomingTranscriptWindow: window({ totalCount: 3, loadedEnd: 2, hasNewer: true, isPartial: true }),
  });

  assert.deepEqual(
    result.transcript.map((message) => message.id),
    ['user-1', 'assistant-1', 'local:send:1'],
  );
  assert.equal(result.transcriptWindow.loadedEnd, 3);
});

test('busy session.opened keeps local streaming rows while adopting incoming latest window metadata', () => {
  const localTranscript = [assistantMessage('req-1:1', 'Partial reply', 'streaming')];
  const incomingTranscript = [assistantMessage('assistant-5', 'Latest persisted row', 'completed')];

  const result = resolveSessionOpenedTranscript({
    busy: true,
    localTranscript,
    incomingTranscript,
    incomingTranscriptWindow: window({
      totalCount: 5,
      loadedStart: 3,
      loadedEnd: 5,
      hasOlder: true,
      hasNewer: false,
      isPartial: true,
    }),
  });

  assert.equal(result.preserveLocal, true);
  assert.deepEqual(result.transcript.map((message) => message.id), ['assistant-5', 'req-1:1']);
  assert.equal(result.transcriptWindow.hasNewer, false);
  assert.equal(result.transcriptWindow.loadedEnd, 6);
});

test('idle session.opened prefers the incoming transcript', () => {
  const localTranscript = [
    userMessage('user-1', 'Prompt'),
    assistantMessage('req-1:1', 'Partial reply', 'streaming'),
  ];
  const incomingTranscript = [
    userMessage('user-1', 'Prompt'),
    assistantMessage('req-1:1', 'Final reply', 'completed'),
  ];

  const result = resolveSessionOpenedTranscript({
    busy: false,
    localTranscript,
    incomingTranscript,
    incomingTranscriptWindow: window({ totalCount: 2, loadedEnd: 2 }),
  });

  assert.equal(result.preserveLocal, false);
  assert.deepEqual(result.transcript, incomingTranscript);
  assert.equal(result.transcriptWindow.loadedEnd, 2);
});
