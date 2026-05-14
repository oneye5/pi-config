import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('package manifest exposes the export run analytics command for keybindings and automation', async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as {
    activationEvents?: string[];
    contributes?: {
      commands?: Array<{ command?: string }>;
    };
  };

  const commands = manifest.contributes?.commands?.map((entry) => entry.command) ?? [];
  assert.ok(commands.includes('pie.exportRunAnalytics'));
  assert.ok(manifest.activationEvents?.includes('onCommand:pie.exportRunAnalytics'));
});
