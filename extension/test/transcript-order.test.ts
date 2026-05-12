import test from 'node:test';
import assert from 'node:assert/strict';

import { mapTranscript, type SessionEntryLike } from '../src/backend/transcript';

test('mapTranscript preserves assistant part ordering from session entries', () => {
  const entries: SessionEntryLike[] = [
    {
      id: 'user-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'message',
      message: {
        role: 'user',
        content: 'hello',
      },
    },
    {
      id: 'assistant-1',
      timestamp: '2026-01-01T00:00:05.000Z',
      type: 'message',
      message: {
        role: 'assistant',
        timestamp: Date.parse('2026-01-01T00:00:02.000Z'),
        content: [
          { type: 'thinking', thinking: 'plan' },
          { type: 'toolCall', id: 'tc-1', name: 'write', arguments: { path: 'a.txt' } },
          { type: 'text', text: 'after write' },
          { type: 'toolCall', id: 'tc-2', name: 'read', arguments: { path: 'a.txt' } },
          { type: 'thinking', thinking: 'done' },
        ],
      },
    },
    {
      id: 'tool-result-1',
      timestamp: '2026-01-01T00:00:05.500Z',
      type: 'message',
      message: {
        role: 'toolResult',
        toolCallId: 'tc-1',
        details: { ok: true },
      },
    },
    {
      id: 'tool-result-2',
      timestamp: '2026-01-01T00:00:06.000Z',
      type: 'message',
      message: {
        role: 'toolResult',
        toolCallId: 'tc-2',
        details: { ok: true },
      },
    },
  ];

  const transcript = mapTranscript(entries);
  const assistant = transcript.find((message) => message.id === 'assistant-1');

  assert.deepEqual(
    assistant?.parts?.map((part) =>
      part.kind === 'toolCall'
        ? `${part.kind}:${part.toolCall.id}:${part.toolCall.status}`
        : `${part.kind}:${part.text}`,
    ),
    [
      'reasoning:plan',
      'toolCall:tc-1:completed',
      'text:after write',
      'toolCall:tc-2:completed',
      'reasoning:done',
    ],
  );
});

test('mapTranscript attaches assistant reply metadata from session settings', () => {
  const entries: SessionEntryLike[] = [
    {
      id: 'model-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'model_change',
      modelId: 'gpt-5.4',
    },
    {
      id: 'thinking-1',
      timestamp: '2026-01-01T00:00:00.100Z',
      type: 'thinking_level_change',
      thinkingLevel: 'xhigh',
    },
    {
      id: 'user-1',
      timestamp: '2026-01-01T00:00:01.000Z',
      type: 'message',
      message: {
        role: 'user',
        content: 'hello',
      },
    },
    {
      id: 'assistant-1',
      timestamp: '2026-01-01T00:00:03.000Z',
      type: 'message',
      message: {
        role: 'assistant',
        timestamp: Date.parse('2026-01-01T00:00:02.000Z'),
        content: [
          { type: 'text', text: 'hi there' },
        ],
      },
    },
  ];

  const transcript = mapTranscript(entries);
  const assistant = transcript.find((message) => message.id === 'assistant-1');

  assert.equal(assistant?.modelId, 'gpt-5.4');
  assert.equal(assistant?.thinkingLevel, 'xhigh');
});

test('mapTranscript preserves continuation separators in assistant parts', () => {
  const entries: SessionEntryLike[] = [
    {
      id: 'user-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'message',
      message: {
        role: 'user',
        content: 'hello',
      },
    },
    {
      id: 'assistant-1',
      timestamp: '2026-01-01T00:00:03.000Z',
      type: 'message',
      message: {
        role: 'assistant',
        timestamp: Date.parse('2026-01-01T00:00:01.000Z'),
        content: [
          { type: 'text', text: 'first answer' },
        ],
      },
    },
    {
      id: 'assistant-2',
      timestamp: '2026-01-01T00:00:06.000Z',
      type: 'message',
      message: {
        role: 'assistant',
        timestamp: Date.parse('2026-01-01T00:00:04.000Z'),
        content: [
          { type: 'text', text: 'second answer' },
        ],
      },
    },
  ];

  const transcript = mapTranscript(entries);
  const assistant = transcript.find((message) => message.id === 'assistant-1');

  assert.equal(assistant?.markdown, 'first answer\n\nsecond answer');
  assert.deepEqual(
    assistant?.parts?.map((part) =>
      part.kind === 'toolCall'
        ? `${part.kind}:${part.toolCall.id}`
        : `${part.kind}:${part.text}`,
    ),
    [
      'text:first answer\n\nsecond answer',
    ],
  );
});
