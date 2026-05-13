import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRenderableSubagentResult,
  rawMessagesToChatMessages,
  subagentSingleResultToChatMessages,
} from '../src/webview/panel/transcript';

test('rawMessagesToChatMessages resolves subagent toolResult messages by toolCallId', () => {
  const messages = rawMessagesToChatMessages([
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Checking files' },
        { type: 'toolCall', id: 'tc-1', name: 'bash', arguments: { command: 'pwd' } },
        { type: 'toolCall', id: 'tc-2', name: 'read', arguments: { path: 'panel.css' } },
      ],
      timestamp: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    {
      role: 'toolResult',
      toolCallId: 'tc-1',
      details: { exitCode: 0 },
      timestamp: Date.parse('2026-01-01T00:00:01.000Z'),
    },
  ] as any, 'subagent');

  const assistant = messages.find((message) => message.role === 'assistant');

  assert.deepEqual(
    assistant?.toolCalls?.map((toolCall) => ({
      id: toolCall.id,
      status: toolCall.status,
      result: toolCall.result,
    })),
    [
      { id: 'tc-1', status: 'completed', result: { exitCode: 0 } },
      { id: 'tc-2', status: 'running', result: undefined },
    ],
  );
});

test('rawMessagesToChatMessages preserves failed subagent tool results', () => {
  const messages = rawMessagesToChatMessages([
    {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tc-1', name: 'bash', arguments: { command: 'exit 1' } },
      ],
    },
    {
      role: 'toolResult',
      toolCallId: 'tc-1',
      content: 'permission denied',
      isError: true,
    },
  ] as any, 'subagent');

  const assistant = messages.find((message) => message.role === 'assistant');

  assert.equal(assistant?.toolCalls?.[0]?.status, 'failed');
  assert.equal(assistant?.toolCalls?.[0]?.result, 'permission denied');
});

test('rawMessagesToChatMessages still supports legacy user-carried tool results', () => {
  const messages = rawMessagesToChatMessages([
    {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tc-1', name: 'read', arguments: { path: 'panel.css' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'toolResult', id: 'tc-1', result: { lines: 42 } },
      ],
    },
  ] as any, 'subagent');

  const assistant = messages.find((message) => message.role === 'assistant');

  assert.equal(assistant?.toolCalls?.[0]?.status, 'completed');
  assert.deepEqual(assistant?.toolCalls?.[0]?.result, { lines: 42 });
});

test('getRenderableSubagentResult falls back when a failed parallel dispatch has no child results', () => {
  assert.equal(getRenderableSubagentResult({
    content: [{ type: 'text', text: 'Too many parallel tasks (6). Max is 5.' }],
    details: {
      mode: 'parallel',
      results: [],
    },
    isError: true,
  } as any), undefined);
});

test('subagentSingleResultToChatMessages synthesizes failure details when no nested messages exist', () => {
  const messages = subagentSingleResultToChatMessages({
    agent: 'reviewer',
    task: 'Inspect dispatch failure',
    exitCode: 1,
    messages: [],
    stderr: 'spawn EPERM',
    stopReason: 'error',
  } as any, 'subagent');

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.status, 'error');
  assert.match(messages[0]?.markdown ?? '', /spawn EPERM/);
});

test('subagentSingleResultToChatMessages does not mislabel placeholder running results as failures', () => {
  const messages = subagentSingleResultToChatMessages({
    agent: 'reviewer',
    task: 'Inspect dispatch failure',
    exitCode: -1,
    messages: [],
    runningTools: ['bash'],
  } as any, 'subagent');

  assert.deepEqual(messages, []);
});
