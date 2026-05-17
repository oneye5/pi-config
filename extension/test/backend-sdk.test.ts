import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { loadSdk, loadSdkInternalModule } from '../src/backend/sdk';

async function withSdkDir(files: Record<string, string>, run: (sdkDir: string) => Promise<void>): Promise<void> {
  const sdkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-sdk-contract-test-'));
  try {
    await fs.writeFile(path.join(sdkDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(sdkDir, relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');
    }
    await run(sdkDir);
  } finally {
    await fs.rm(sdkDir, { recursive: true, force: true });
  }
}

test('loadSdk rejects disallowed paths before attempting to import', async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  await assert.rejects(
    async () => await loadSdk(path.resolve(testDir, '..', 'src')),
    /Refusing to load SDK from disallowed path/,
  );
});

test('loadSdk imports allowed ESM SDK modules that satisfy the contract', async () => {
  await withSdkDir({
    'dist/index.js': `
      export const VERSION = 'test-sdk';
      export const getAgentDir = () => '/agent';
      export const AuthStorage = { create: (filePath) => ({ filePath }) };
      export const SessionManager = {
        listAll: async () => [],
        continueRecent: (cwd) => ({ cwd, getCwd: () => cwd, getSessionFile: () => undefined, getSessionName: () => undefined, getBranch: () => [], getEntries: () => [] }),
        create: (cwd) => ({ cwd, getCwd: () => cwd, getSessionFile: () => undefined, getSessionName: () => undefined, getBranch: () => [], getEntries: () => [] }),
        open: (sessionPath) => ({ getCwd: () => '/repo', getSessionFile: () => sessionPath, getSessionName: () => undefined, getBranch: () => [], getEntries: () => [] }),
      };
      export const createAgentSessionServices = async () => ({ services: true });
      export const createAgentSessionFromServices = async () => ({ session: true });
      export const createAgentSessionRuntime = async () => ({ session: { isStreaming: false }, services: { modelRegistry: { getAvailable: () => [], find: () => undefined } }, dispose: async () => {} });
    `,
    'dist/core/system-prompt.js': `export const buildSystemPrompt = (options) => JSON.stringify(options);`,
  }, async (sdkDir) => {
    const sdk = await loadSdk(sdkDir);
    const systemPromptModule = await loadSdkInternalModule<{ buildSystemPrompt: (options: unknown) => string }>(sdkDir, path.join('core', 'system-prompt.js'));

    assert.equal(sdk.VERSION, 'test-sdk');
    assert.equal(sdk.getAgentDir(), '/agent');
    assert.deepEqual(await sdk.SessionManager.listAll(), []);
    assert.equal(systemPromptModule.buildSystemPrompt({ cwd: '/repo' }), '{"cwd":"/repo"}');
  });
});

test('loadSdk rejects modules that are missing required exports', async () => {
  await withSdkDir({
    'dist/index.js': `export const VERSION = 'broken-sdk'; export const getAgentDir = () => '/agent';`,
  }, async (sdkDir) => {
    await assert.rejects(
      async () => await loadSdk(sdkDir),
      /missing required exports/,
    );
  });
});
