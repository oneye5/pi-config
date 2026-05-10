import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSessionOpenedTranscript } from '../src/host/session-opened-transcript';
import type { ChatMessage } from '../src/shared/protocol';

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
  });

  assert.equal(result.preserveLocal, true);
  assert.deepEqual(result.transcript, localTranscript);
});

test('busy session.opened keeps optimistic local transcript rows', () => {
  const localTranscript = [
    userMessage('user-1', 'Prompt'),
    userMessage('local:send:1', 'Prompt with attachment'),
  ];

  const result = resolveSessionOpenedTranscript({
    busy: true,
    localTranscript,
    incomingTranscript: [userMessage('user-1', 'Prompt')],
  });

  assert.equal(result.preserveLocal, true);
  assert.deepEqual(result.transcript, localTranscript);
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
  });

  assert.equal(result.preserveLocal, false);
  assert.deepEqual(result.transcript, incomingTranscript);
});
