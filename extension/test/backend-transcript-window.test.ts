import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPagedTranscriptWindow,
  type DisplayTranscriptCache,
} from '../src/backend/transcript-window';
import type { ChatMessage } from '../src/shared/protocol';

function buildMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    createdAt: '2026-01-01T00:00:00.000Z',
    markdown: `message ${index}`,
    status: 'completed',
  }));
}

function buildCache(count: number): DisplayTranscriptCache {
  return {
    transcript: buildMessages(count),
    hasUserMessages: true,
    branchEntryCount: count,
    branchLastEntryId: `entry-${count - 1}`,
  };
}

test('buildPagedTranscriptWindow older paging advances once max window budget is reached', () => {
  const cache = buildCache(500);

  const olderPage = buildPagedTranscriptWindow(cache, {
    direction: 'older',
    loadedStart: 260,
    loadedEnd: 500,
    pageSize: 40,
    maxLoadedCount: 240,
  }).transcriptWindow;

  assert.deepEqual({ start: olderPage.loadedStart, end: olderPage.loadedEnd }, { start: 220, end: 460 });

  const olderPageAgain = buildPagedTranscriptWindow(cache, {
    direction: 'older',
    loadedStart: olderPage.loadedStart,
    loadedEnd: olderPage.loadedEnd,
    pageSize: 40,
    maxLoadedCount: 240,
  }).transcriptWindow;

  assert.deepEqual({ start: olderPageAgain.loadedStart, end: olderPageAgain.loadedEnd }, { start: 180, end: 420 });
});

test('buildPagedTranscriptWindow newer paging advances once max window budget is reached', () => {
  const cache = buildCache(500);

  const newerPage = buildPagedTranscriptWindow(cache, {
    direction: 'newer',
    loadedStart: 180,
    loadedEnd: 420,
    pageSize: 40,
    maxLoadedCount: 240,
  }).transcriptWindow;

  assert.deepEqual({ start: newerPage.loadedStart, end: newerPage.loadedEnd }, { start: 220, end: 460 });
});
