import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readPanelCss() {
  return readFile(new URL('../src/webview/panel/panel.css', import.meta.url), 'utf8');
}

test('collapsed tool-call status keeps enough reserved width for running labels', async () => {
  const css = await readPanelCss();
  const statusRule = css.match(/\.tool-call-status\s*\{[\s\S]*?\n\}/);

  assert.match(css, /--tool-call-status-column-width:\s*10ch;/);
  assert.ok(statusRule, 'expected .tool-call-status rule in panel.css');
  assert.match(statusRule[0], /min-width:\s*var\(--tool-call-status-column-width\);/);
  assert.match(statusRule[0], /max-width:\s*var\(--tool-call-status-column-width\);/);
  assert.match(statusRule[0], /flex:\s*0 0 var\(--tool-call-status-column-width\);/);
  assert.match(statusRule[0], /font-family:\s*var\(--vscode-editor-font-family,\s*monospace\);/);
});
