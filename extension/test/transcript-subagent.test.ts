import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatToolCallResultForDisplay,
  getRenderableSubagentResult,
  getRenderableSubagentResultFromToolCall,
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

test('getRenderableSubagentResultFromToolCall synthesizes running single-mode state from input', () => {
  assert.deepEqual(
    getRenderableSubagentResultFromToolCall({
      input: { agent: 'reviewer', task: 'Inspect regression' },
      result: undefined,
      status: 'running',
    } as any),
    {
      mode: 'single',
      results: [{
        agent: 'reviewer',
        task: 'Inspect regression',
        exitCode: -1,
        messages: [],
      }],
    },
  );
});

test('getRenderableSubagentResultFromToolCall synthesizes fresh running chain-mode state from the first step', () => {
  assert.deepEqual(
    getRenderableSubagentResultFromToolCall({
      input: {
        chain: [
          { agent: 'planner', task: 'Plan the work' },
          { agent: 'reviewer', task: 'Review the result' },
        ],
      },
      result: undefined,
      status: 'running',
    } as any),
    {
      mode: 'chain',
      results: [{
        agent: 'planner',
        task: 'Plan the work',
        exitCode: -1,
        messages: [],
      }],
    },
  );
});

test('getRenderableSubagentResultFromToolCall keeps single-mode progress updates running until the top-level tool finishes', () => {
  const result = getRenderableSubagentResultFromToolCall({
    input: { agent: 'reviewer', task: 'Inspect regression' },
    result: {
      details: {
        mode: 'single',
        results: [{
          agent: 'reviewer',
          task: 'Inspect regression',
          exitCode: 0,
          messages: [],
          runningTools: ['bash'],
        }],
      },
    },
    status: 'running',
  } as any);

  assert.equal(result?.mode, 'single');
  assert.equal(result?.results[0]?.exitCode, -1);
  assert.deepEqual(result?.results[0]?.runningTools, ['bash']);
});

test('getRenderableSubagentResultFromToolCall keeps empty multi-result progress updates running until the top-level tool finishes', () => {
  for (const mode of ['parallel', 'chain'] as const) {
    const result = getRenderableSubagentResultFromToolCall({
      input: mode === 'parallel'
        ? { tasks: [{ agent: 'reviewer', task: 'Step one' }] }
        : { chain: [{ agent: 'reviewer', task: 'Step one' }] },
      result: {
        details: {
          mode,
          results: [{
            agent: 'reviewer',
            task: 'Step one',
            exitCode: 0,
            messages: [],
            runningTools: ['bash'],
          }],
        },
      },
      status: 'running',
    } as any);

    assert.equal(result?.results[0]?.exitCode, -1, `${mode} child should stay running`);
    assert.deepEqual(
      subagentSingleResultToChatMessages(result!.results[0]!, mode).map((message) => message.markdown),
      ['Step one'],
      `${mode} child should not render a premature no-output fallback`,
    );
  }
});

test('formatToolCallResultForDisplay extracts readable top-level subagent failure text', () => {
  assert.equal(
    formatToolCallResultForDisplay({
      name: 'subagent',
      result: {
        content: [{ type: 'text', text: 'Too many parallel tasks (6). Max is 5.' }],
        details: { mode: 'parallel', results: [] },
        isError: true,
      },
    }),
    'Too many parallel tasks (6). Max is 5.',
  );
});

test('rawMessagesToChatMessages preserves top-level subagent failure content when details are present', () => {
  const messages = rawMessagesToChatMessages([
    {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tc-sub', name: 'subagent', arguments: { tasks: [{ agent: 'scout', task: 'Investigate' }] } },
      ],
    },
    {
      role: 'toolResult',
      toolCallId: 'tc-sub',
      content: [{ type: 'text', text: 'Too many parallel tasks (6). Max is 5.' }],
      details: { mode: 'parallel', results: [] },
      isError: true,
    },
  ] as any, 'subagent');

  const toolCall = messages.find((message) => message.role === 'assistant')?.toolCalls?.[0];

  assert.equal(toolCall?.status, 'failed');
  assert.equal(getRenderableSubagentResult(toolCall?.result), undefined);
  assert.equal(formatToolCallResultForDisplay(toolCall as any), 'Too many parallel tasks (6). Max is 5.');
});

test('subagentSingleResultToChatMessages prepends the delegated task when nested messages have no user turn', () => {
  const messages = subagentSingleResultToChatMessages({
    agent: 'reviewer',
    task: 'Inspect regression',
    exitCode: 0,
    messages: [{
      role: 'assistant',
      content: [{ type: 'text', text: 'Looks good.' }],
    }],
  } as any, 'subagent');

  assert.deepEqual(
    messages.map((message) => ({ role: message.role, markdown: message.markdown, status: message.status })),
    [
      { role: 'user', markdown: 'Inspect regression', status: 'completed' },
      { role: 'assistant', markdown: 'Looks good.', status: 'completed' },
    ],
  );
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

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, 'user');
  assert.equal(messages[0]?.markdown, 'Inspect dispatch failure');
  assert.equal(messages[1]?.status, 'error');
  assert.match(messages[1]?.markdown ?? '', /spawn EPERM/);
});

test('subagentSingleResultToChatMessages keeps placeholder running results in task form instead of mislabeling them as failures', () => {
  const messages = subagentSingleResultToChatMessages({
    agent: 'reviewer',
    task: 'Inspect dispatch failure',
    exitCode: -1,
    messages: [],
    runningTools: ['bash'],
  } as any, 'subagent');

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, 'user');
  assert.equal(messages[0]?.markdown, 'Inspect dispatch failure');
});
