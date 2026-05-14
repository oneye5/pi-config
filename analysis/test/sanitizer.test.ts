import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeSourceAnalytics } from '../scripts/sanitize.ts';
import { deepClone, loadFixture, SENTINEL_STRINGS } from './helpers.ts';

test('sanitizeSourceAnalytics strips raw session and context-file paths', async () => {
  const fixture = await loadFixture();
  const sanitized = sanitizeSourceAnalytics(fixture);
  const serialized = JSON.stringify(sanitized);

  for (const sentinel of SENTINEL_STRINGS) {
    assert.ok(!serialized.includes(sentinel), `expected sanitized output to omit ${sentinel}`);
  }

  assert.equal(sanitized.runs.length, 7);
  assert.ok(sanitized.runs.every((run) => typeof run.sessionPathHash === 'string' && run.sessionPathHash.length === 16));
  assert.ok(sanitized.toolUsage.some((row) => row.toolName === 'subagent'));
  assert.ok(sanitized.verificationUsage.some((row) => row.kind === 'test'));
});

test('sanitizeSourceAnalytics normalizes max thinking level alias to xhigh', async () => {
  const fixture = deepClone(await loadFixture());
  (fixture.completedRuns[0] as any).thinkingLevel = 'max';

  const sanitized = sanitizeSourceAnalytics(fixture);
  assert.equal(sanitized.runs[0]?.thinkingLevel, 'xhigh');
});

test('sanitizeSourceAnalytics deduplicates run ids across completed and open snapshots', async () => {
  const fixture = deepClone(await loadFixture());
  const duplicateOpenRun = {
    ...fixture.completedRuns[0],
    status: 'open',
    scored: false,
    outcome: undefined,
    updatedAt: '2099-01-01T00:00:00.000Z',
  } as any;
  fixture.openRuns.push(duplicateOpenRun);

  const sanitized = sanitizeSourceAnalytics(fixture);
  const duplicateRunId = fixture.completedRuns[0]?.runId;
  const matchingRuns = sanitized.runs.filter((run) => run.runId === duplicateRunId);

  assert.equal(matchingRuns.length, 1);
  assert.equal(matchingRuns[0]?.status, fixture.completedRuns[0]?.status);
});
