import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolveCommandInvocation } from '../src/shared/command-invocation';
import {
  getSdkCliPath,
  resolveNodePath,
  resolveSdkPath,
} from '../src/shared/runtime-resolution';

test('resolveCommandInvocation wraps npm with cmd.exe on Windows', () => {
  const invocation = resolveCommandInvocation('npm', ['root', '-g'], {
    platform: 'win32',
    comSpec: 'C:/Windows/System32/cmd.exe',
  });

  assert.deepEqual(invocation, {
    command: 'C:/Windows/System32/cmd.exe',
    args: ['/d', '/s', '/c', 'npm root -g'],
  });
});

test('resolveCommandInvocation leaves non-Windows commands unchanged', () => {
  const invocation = resolveCommandInvocation('npm', ['root', '-g'], {
    platform: 'linux',
  });

  assert.deepEqual(invocation, {
    command: 'npm',
    args: ['root', '-g'],
  });
});

test('sdk lookup surfaces npm execution failure', async () => {
  await assert.rejects(
    () =>
      resolveSdkPath({
        env: {},
        exists: () => false,
        exec: async () => ({
          stdout: '',
          stderr: 'spawn ENOENT',
          exitCode: 1,
        }),
      }),
    /Failed to resolve the global PI SDK install via npm root -g/,
  );
});

test('resolveNodePath prefers configured setting', () => {
  const nodePath = resolveNodePath({
    configuredPath: 'C:/custom/node.exe',
    env: {},
    platform: 'win32',
    exists: (filePath) => filePath === 'C:/custom/node.exe',
  });

  assert.equal(nodePath, 'C:/custom/node.exe');
});

test('resolveNodePath falls back to PATH lookup', () => {
  const expectedPath = path.join('D:/tools', 'node.exe');
  const nodePath = resolveNodePath({
    env: {
      PATH: 'C:/bin;D:/tools',
    },
    platform: 'win32',
    exists: (filePath) => filePath === expectedPath,
  });

  assert.equal(nodePath, expectedPath);
});

test('resolveSdkPath prefers configured sdk path', async () => {
  const packageJsonPath = path.join('/opt/pi-sdk', 'package.json');
  const indexJsPath = path.join('/opt/pi-sdk', 'dist', 'index.js');
  const sdkPath = await resolveSdkPath({
    configuredPath: '/opt/pi-sdk',
    env: {},
    exists: (filePath) => filePath === packageJsonPath || filePath === indexJsPath,
    exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  });

  assert.equal(sdkPath, '/opt/pi-sdk');
});

test('resolveSdkPath falls back to npm root -g', async () => {
  const expectedSdkPath = path.join('/global/node_modules', '@mariozechner', 'pi-coding-agent');
  const sdkPath = await resolveSdkPath({
    env: {},
    exists: (filePath) => {
      return (
        filePath === path.join(expectedSdkPath, 'package.json') ||
        filePath === path.join(expectedSdkPath, 'dist', 'index.js')
      );
    },
    exec: async () => ({
      stdout: '/global/node_modules\n',
      stderr: '',
      exitCode: 0,
    }),
  });

  assert.equal(sdkPath, expectedSdkPath);
});

test('getSdkCliPath points at dist cli entry', () => {
  assert.match(getSdkCliPath('/opt/pi-sdk'), /dist[\\/]cli\.js$/);
});
