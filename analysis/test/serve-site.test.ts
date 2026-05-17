import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';

import { resolveSiteRequestPath } from '../scripts/serve-site-paths.ts';

const SITE_ROOT = path.resolve('analysis/site');

test('resolveSiteRequestPath serves canonical allowed data files only', () => {
  assert.equal(
    resolveSiteRequestPath(SITE_ROOT, '/data/manifest.json'),
    path.resolve(SITE_ROOT, 'data', 'manifest.json'),
  );
  assert.equal(
    resolveSiteRequestPath(SITE_ROOT, '/data/Manifest.json'),
    path.resolve(SITE_ROOT, 'data', 'manifest.json'),
  );
  assert.equal(
    resolveSiteRequestPath(SITE_ROOT, '/dist/../data/manifest.json'),
    path.resolve(SITE_ROOT, 'data', 'manifest.json'),
  );
});

test('resolveSiteRequestPath rejects unapproved or escaped data paths', () => {
  assert.throws(
    () => resolveSiteRequestPath(SITE_ROOT, '/data/run-analytics.json'),
    /Not found/,
  );
  assert.throws(
    () => resolveSiteRequestPath(SITE_ROOT, '/DATA/run-analytics.json'),
    /Not found/,
  );
  assert.throws(
    () => resolveSiteRequestPath(SITE_ROOT, '/../outside.txt'),
    /Invalid path/,
  );
});

test('resolveSiteRequestPath serves non-data assets and strips query strings', () => {
  assert.equal(
    resolveSiteRequestPath(SITE_ROOT, '/dist/app.js?cache=1'),
    path.resolve(SITE_ROOT, 'dist', 'app.js'),
  );
});

test('resolveSiteRequestPath rejects nested data paths after decoding', () => {
  assert.throws(
    () => resolveSiteRequestPath(SITE_ROOT, '/data/nested/manifest.json'),
    /Not found/,
  );
  assert.throws(
    () => resolveSiteRequestPath(SITE_ROOT, '/data%2Fnested%2Fmanifest.json'),
    /Not found/,
  );
});

test('resolveSiteRequestPath rejects cross-drive absolute paths on Windows', { skip: process.platform !== 'win32' }, () => {
  assert.throws(
    () => resolveSiteRequestPath('C:\\site-root', 'D:/outside.txt'),
    /Invalid path/,
  );
});
