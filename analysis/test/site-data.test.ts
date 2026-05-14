import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';

import { buildSiteDataBundle, readSiteDataBundle, validateSiteDataBundle, writeSiteData } from '../scripts/site-data.ts';
import { sanitizeSourceAnalytics } from '../scripts/sanitize.ts';
import { collectSensitiveSourceStrings } from '../scripts/source.ts';
import { deepClone, loadFixture, SENTINEL_STRINGS, withTempDir } from './helpers.ts';

test('site data generation writes the expected files and enforces privacy invariants', async () => {
  await withTempDir(async (dir) => {
    const fixture = await loadFixture();
    const sanitized = sanitizeSourceAnalytics(fixture);
    const bundle = buildSiteDataBundle(sanitized, new Date('2026-05-14T00:00:00.000Z'));
    validateSiteDataBundle(bundle, collectSensitiveSourceStrings(fixture));

    await writeSiteData(dir, bundle);

    for (const fileName of [
      'manifest.json',
      'overview.json',
      'run-summary.json',
      'model-quality.json',
      'verification-impact.json',
      'tool-usage.json',
      'treatment-comparison.json',
      'timeline.json',
    ]) {
      const content = await fs.readFile(path.join(dir, fileName), 'utf8');
      for (const sentinel of SENTINEL_STRINGS) {
        assert.ok(!content.includes(sentinel), `${fileName} leaked ${sentinel}`);
      }
    }

    const roundTrip = await readSiteDataBundle(dir);
    assert.equal(roundTrip.manifest.completedRunCount, 6);
    assert.equal(roundTrip.runSummary.rows.length, 7);
    assert.ok(roundTrip.verificationImpact.summaryRows.length > 0);
    assert.ok(roundTrip.toolUsage.summaryRows.length > 0);
  });
});

test('site data generation handles no-scored and open-only edge cases', async () => {
  const fixture = deepClone(await loadFixture());
  fixture.completedRuns.forEach((run) => {
    run.scored = false;
    delete (run as Partial<typeof run>).outcome;
  });
  fixture.outcomes = [];

  const bundle = buildSiteDataBundle(sanitizeSourceAnalytics(fixture));
  validateSiteDataBundle(bundle, collectSensitiveSourceStrings(fixture));
  assert.equal(bundle.overview.totalScoredRuns, 0);
  assert.equal(bundle.timeline.rows.length > 0, true);
});

test('unexpected files or nested directories in the site-data directory fail validation', async () => {
  await withTempDir(async (dir) => {
    const fixture = await loadFixture();
    const bundle = buildSiteDataBundle(sanitizeSourceAnalytics(fixture));
    await writeSiteData(dir, bundle);
    await fs.writeFile(path.join(dir, 'run-analytics.json'), JSON.stringify({ completedRuns: [] }), 'utf8');

    await assert.rejects(
      async () => await readSiteDataBundle(dir),
      /Unexpected JSON file found in site data directory: run-analytics.json/,
    );

    await fs.rm(path.join(dir, 'run-analytics.json'), { force: true });
    await fs.mkdir(path.join(dir, 'private'), { recursive: true });
    await fs.writeFile(path.join(dir, 'private', 'manifest.json'), '{}', 'utf8');

    await assert.rejects(
      async () => await readSiteDataBundle(dir),
      /Unexpected subdirectory found in site data directory: private/,
    );
  });
});

test('site data generation tolerates unknown model ids and ignores unknown verification kinds', async () => {
  const fixture = deepClone(await loadFixture());
  delete (fixture.completedRuns[0] as Partial<typeof fixture.completedRuns[0]>).modelId;
  (fixture.completedRuns[0] as any).verification.countsByKind.unexpected = 99;

  const sanitized = sanitizeSourceAnalytics(fixture);
  const bundle = buildSiteDataBundle(sanitized);
  validateSiteDataBundle(bundle, collectSensitiveSourceStrings(fixture));

  assert.equal(bundle.runSummary.rows[0]?.modelId, null);
  assert.ok(bundle.modelQuality.rows.some((row) => row.modelId === '(unknown)'));
  assert.ok(!JSON.stringify(bundle).includes('unexpected'));
});

test('privacy validation fails when a raw path value is injected into an allowed field', async () => {
  const fixture = await loadFixture();
  const bundle = buildSiteDataBundle(sanitizeSourceAnalytics(fixture));
  const dangerous = JSON.parse(JSON.stringify(bundle)) as Record<string, any>;
  dangerous.runSummary.rows[0].sessionPathHash = 'C:\\Users\\secret\\private-run.jsonl';

  assert.throws(
    () => validateSiteDataBundle(dangerous as never, collectSensitiveSourceStrings(fixture)),
    /Path-like content leaked|Sensitive source value leaked/,
  );
});

test('privacy validation fails when a raw sessionPath key is injected', async () => {
  const fixture = await loadFixture();
  const bundle = buildSiteDataBundle(sanitizeSourceAnalytics(fixture));
  const dangerous = JSON.parse(JSON.stringify(bundle)) as Record<string, any>;
  dangerous.runSummary.rows[0].sessionPath = 'raw/private/path.jsonl';

  assert.throws(
    () => validateSiteDataBundle(dangerous as never, collectSensitiveSourceStrings(fixture)),
    /Forbidden raw source key sessionPath/,
  );
});
