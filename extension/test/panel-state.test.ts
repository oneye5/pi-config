import test from 'node:test';
import assert from 'node:assert/strict';

import { isPanelBooting, resolvePanelSurface } from '../src/webview/panel/panel-state';

test('isPanelBooting treats backend startup without a notice as loading', () => {
  assert.equal(isPanelBooting({ backendReady: false, notice: null }), true);
  assert.equal(isPanelBooting({ backendReady: false, notice: '' }), true);
});

test('isPanelBooting stops once an error notice is present', () => {
  assert.equal(isPanelBooting({ backendReady: false, notice: 'Backend failed to start' }), false);
});

test('resolvePanelSurface hides restored tabs while the backend is still booting', () => {
  assert.equal(resolvePanelSurface({
    backendReady: false,
    notice: null,
    openTabPaths: ['/workspace/session-a.jsonl'],
  }), 'loading');
});

test('resolvePanelSurface shows the empty state once startup has completed without tabs', () => {
  assert.equal(resolvePanelSurface({
    backendReady: true,
    notice: null,
    openTabPaths: [],
  }), 'empty');
});

test('resolvePanelSurface shows the session surface once tabs are available', () => {
  assert.equal(resolvePanelSurface({
    backendReady: true,
    notice: null,
    openTabPaths: ['/workspace/session-a.jsonl'],
  }), 'session');
});
