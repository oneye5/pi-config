import test from 'node:test';
import assert from 'node:assert/strict';

import { syncDisclosureOpenState } from '../src/webview/panel/disclosure-state';

test('syncDisclosureOpenState preserves manual state while the default stays unchanged', () => {
  assert.equal(syncDisclosureOpenState(true, false, false), true);
  assert.equal(syncDisclosureOpenState(false, true, true), false);
});

test('syncDisclosureOpenState follows preference changes when the default toggles', () => {
  assert.equal(syncDisclosureOpenState(false, false, true), true);
  assert.equal(syncDisclosureOpenState(true, true, false), false);
});
