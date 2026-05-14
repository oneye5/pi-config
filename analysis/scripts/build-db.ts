#!/usr/bin/env node
import { parseCliOptions, formatUsage } from './cli.ts';
import { buildDuckDbDatabase } from './duckdb.ts';
import { sanitizeSourceAnalytics } from './sanitize.ts';
import { DEFAULT_DUCKDB_PATH, DEFAULT_STAGING_EXPORTS_DIR, loadSourceAnalytics } from './source.ts';

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.help) {
    console.log(formatUsage('npm run build-db --', 'Build a local DuckDB database from a private run-analytics source.'));
    return;
  }

  const loaded = await loadSourceAnalytics({ exportPath: options.exportPath, storageDir: options.storageDir });
  if (loaded.sourceKind === 'fixture') {
    console.warn('Warning: using fixture analytics data. Pass --export or --storage-dir to analyze real local runs.');
  }
  const sanitized = sanitizeSourceAnalytics(loaded.source);
  const dbPath = options.dbPath ?? DEFAULT_DUCKDB_PATH;
  const exportsDir = options.exportsDir ?? DEFAULT_STAGING_EXPORTS_DIR;

  await buildDuckDbDatabase({ dbPath, exportsDir, sanitized });

  console.log(`Source: ${loaded.sourceKind} (${loaded.sourcePath})`);
  console.log(`Exported at: ${loaded.source.exportedAt}`);
  console.log(`Workspace key: ${loaded.source.workspaceKey}`);
  console.log(`DuckDB: ${dbPath}`);
  console.log(`Staging exports: ${exportsDir}`);
  console.log(`Runs loaded: ${sanitized.runs.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
