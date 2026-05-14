#!/usr/bin/env node
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const SITE_DIR = fileURLToPath(new URL('../site', import.meta.url));
const ENTRY_PATH = path.join(SITE_DIR, 'app.ts');
const OUTFILE_PATH = path.join(SITE_DIR, 'dist', 'app.js');

async function main(): Promise<void> {
  await build({
    entryPoints: [ENTRY_PATH],
    outfile: OUTFILE_PATH,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    sourcemap: true,
    logLevel: 'info',
  });

  console.log(`Built browser bundle: ${OUTFILE_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
