import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  SanitizedAnalyticsData,
  SanitizedBackendErrorRow,
  SanitizedRunRow,
  SanitizedToolUsageRow,
  SanitizedVerificationUsageRow,
} from './contracts.ts';
import { ensureDir, sqlStringLiteral, writeJsonFile } from './fs-utils.ts';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const QUERY_FILE_BY_NAME = {
  core_runs: path.resolve(SCRIPT_DIR, '../queries/001_core_runs.sql'),
  model_quality: path.resolve(SCRIPT_DIR, '../queries/model_quality.sql'),
  verification_impact: path.resolve(SCRIPT_DIR, '../queries/verification_impact.sql'),
  tool_usage: path.resolve(SCRIPT_DIR, '../queries/tool_usage.sql'),
  treatment_comparison: path.resolve(SCRIPT_DIR, '../queries/treatment_comparison.sql'),
  timeline: path.resolve(SCRIPT_DIR, '../queries/timeline.sql'),
} as const;

export type NamedQuery = keyof typeof QUERY_FILE_BY_NAME;

interface DuckDbRunRow {
  run_id: string;
  task_group_id: string;
  session_path_hash: string;
  status: string;
  scored: boolean;
  started_at: string;
  started_day: string;
  updated_at: string;
  finalized_at: string | null;
  finalization_reason: string | null;
  resolution: string | null;
  satisfaction: number | null;
  model_id: string | null;
  thinking_level: string | null;
  mixed_model_config: boolean;
  mixed_treatment_config: boolean;
  experiment_assignment: string | null;
  prompt_family: string | null;
  prompt_hash_prefix: string | null;
  tool_set_hash_prefix: string | null;
  skill_set_hash_prefix: string | null;
  selected_tool_count: number;
  skill_count: number;
  context_file_count: number;
  prompt_guideline_count: number;
  send_count: number;
  assistant_turn_count: number;
  assistant_turn_duration_ms: number;
  busy_duration_ms: number;
  busy_period_count: number;
  interrupted_count: number;
  message_edit_count: number;
  truncated_after_count: number;
  backend_error_count: number;
  context_tokens: number | null;
  context_limit: number | null;
  filesystem_path_ref_count: number;
  image_input_count: number;
  image_input_bytes: number;
  unsupported_input_count: number;
  input_kinds_used: string[];
  tool_call_count: number;
  tool_failure_count: number;
  subagent_call_count: number;
  subagent_task_count: number;
  subagent_agent_count: number;
  verification_total_count: number;
  verification_failure_count: number;
  verification_state: string;
  verification_count_bucket: string;
  verification_test_count: number;
  verification_build_count: number;
  verification_lint_count: number;
  verification_typecheck_count: number;
  verification_format_count: number;
  verification_other_count: number;
  file_write_count: number;
  file_edit_count: number;
  file_delete_count: number;
  file_rename_count: number;
  touched_file_count: number;
  line_additions: number;
  line_deletions: number;
  line_modifications: number;
  line_mutation_total: number;
}

interface DuckDbToolUsageRow {
  run_id: string;
  tool_name: string;
  call_count: number;
  failure_count: number;
  started_at: string;
  started_day: string;
  model_id: string | null;
  thinking_level: string | null;
  experiment_assignment: string | null;
  mixed_treatment_config: boolean;
  scored: boolean;
  satisfaction: number | null;
  resolution: string | null;
}

interface DuckDbVerificationUsageRow {
  run_id: string;
  kind: string;
  count: number;
  run_had_any_failure: boolean;
  started_at: string;
  started_day: string;
  model_id: string | null;
  thinking_level: string | null;
  experiment_assignment: string | null;
  mixed_treatment_config: boolean;
  scored: boolean;
  satisfaction: number | null;
  resolution: string | null;
}

interface DuckDbBackendErrorRow {
  run_id: string;
  error_code: string;
  count: number;
  started_at: string;
  started_day: string;
  model_id: string | null;
  thinking_level: string | null;
  experiment_assignment: string | null;
  scored: boolean;
  satisfaction: number | null;
  resolution: string | null;
}

function toDuckDbRunRow(row: SanitizedRunRow): DuckDbRunRow {
  return {
    run_id: row.runId,
    task_group_id: row.taskGroupId,
    session_path_hash: row.sessionPathHash,
    status: row.status,
    scored: row.scored,
    started_at: row.startedAt,
    started_day: row.startedDay,
    updated_at: row.updatedAt,
    finalized_at: row.finalizedAt,
    finalization_reason: row.finalizationReason,
    resolution: row.resolution,
    satisfaction: row.satisfaction,
    model_id: row.modelId,
    thinking_level: row.thinkingLevel,
    mixed_model_config: row.mixedModelConfig,
    mixed_treatment_config: row.mixedTreatmentConfig,
    experiment_assignment: row.experimentAssignment,
    prompt_family: row.promptFamily,
    prompt_hash_prefix: row.promptHashPrefix,
    tool_set_hash_prefix: row.toolSetHashPrefix,
    skill_set_hash_prefix: row.skillSetHashPrefix,
    selected_tool_count: row.selectedToolCount,
    skill_count: row.skillCount,
    context_file_count: row.contextFileCount,
    prompt_guideline_count: row.promptGuidelineCount,
    send_count: row.sendCount,
    assistant_turn_count: row.assistantTurnCount,
    assistant_turn_duration_ms: row.assistantTurnDurationMs,
    busy_duration_ms: row.busyDurationMs,
    busy_period_count: row.busyPeriodCount,
    interrupted_count: row.interruptedCount,
    message_edit_count: row.messageEditCount,
    truncated_after_count: row.truncatedAfterCount,
    backend_error_count: row.backendErrorCount,
    context_tokens: row.contextTokens,
    context_limit: row.contextLimit,
    filesystem_path_ref_count: row.filesystemPathRefCount,
    image_input_count: row.imageInputCount,
    image_input_bytes: row.imageInputBytes,
    unsupported_input_count: row.unsupportedInputCount,
    input_kinds_used: row.inputKindsUsed,
    tool_call_count: row.toolCallCount,
    tool_failure_count: row.toolFailureCount,
    subagent_call_count: row.subagentCallCount,
    subagent_task_count: row.subagentTaskCount,
    subagent_agent_count: row.subagentAgentCount,
    verification_total_count: row.verificationTotalCount,
    verification_failure_count: row.verificationFailureCount,
    verification_state: row.verificationState,
    verification_count_bucket: row.verificationCountBucket,
    verification_test_count: row.verificationCountsByKind.test,
    verification_build_count: row.verificationCountsByKind.build,
    verification_lint_count: row.verificationCountsByKind.lint,
    verification_typecheck_count: row.verificationCountsByKind.typecheck,
    verification_format_count: row.verificationCountsByKind.format,
    verification_other_count: row.verificationCountsByKind.other,
    file_write_count: row.fileWriteCount,
    file_edit_count: row.fileEditCount,
    file_delete_count: row.fileDeleteCount,
    file_rename_count: row.fileRenameCount,
    touched_file_count: row.touchedFileCount,
    line_additions: row.lineAdditions,
    line_deletions: row.lineDeletions,
    line_modifications: row.lineModifications,
    line_mutation_total: row.lineMutationTotal,
  };
}

function toDuckDbToolUsageRow(row: SanitizedToolUsageRow): DuckDbToolUsageRow {
  return {
    run_id: row.runId,
    tool_name: row.toolName,
    call_count: row.callCount,
    failure_count: row.failureCount,
    started_at: row.startedAt,
    started_day: row.startedDay,
    model_id: row.modelId,
    thinking_level: row.thinkingLevel,
    experiment_assignment: row.experimentAssignment,
    mixed_treatment_config: row.mixedTreatmentConfig,
    scored: row.scored,
    satisfaction: row.satisfaction,
    resolution: row.resolution,
  };
}

function toDuckDbVerificationUsageRow(row: SanitizedVerificationUsageRow): DuckDbVerificationUsageRow {
  return {
    run_id: row.runId,
    kind: row.kind,
    count: row.count,
    run_had_any_failure: row.runHadAnyFailure,
    started_at: row.startedAt,
    started_day: row.startedDay,
    model_id: row.modelId,
    thinking_level: row.thinkingLevel,
    experiment_assignment: row.experimentAssignment,
    mixed_treatment_config: row.mixedTreatmentConfig,
    scored: row.scored,
    satisfaction: row.satisfaction,
    resolution: row.resolution,
  };
}

function toDuckDbBackendErrorRow(row: SanitizedBackendErrorRow): DuckDbBackendErrorRow {
  return {
    run_id: row.runId,
    error_code: row.errorCode,
    count: row.count,
    started_at: row.startedAt,
    started_day: row.startedDay,
    model_id: row.modelId,
    thinking_level: row.thinkingLevel,
    experiment_assignment: row.experimentAssignment,
    scored: row.scored,
    satisfaction: row.satisfaction,
    resolution: row.resolution,
  };
}

export async function writeDuckDbStagingExports(exportsDir: string, sanitized: SanitizedAnalyticsData): Promise<{
  runsPath: string;
  toolUsagePath: string;
  verificationUsagePath: string;
  backendErrorsPath: string;
}> {
  await ensureDir(exportsDir);
  const runsPath = path.join(exportsDir, 'runs.json');
  const toolUsagePath = path.join(exportsDir, 'tool-usage.json');
  const verificationUsagePath = path.join(exportsDir, 'verification-usage.json');
  const backendErrorsPath = path.join(exportsDir, 'backend-errors.json');

  await Promise.all([
    writeJsonFile(runsPath, sanitized.runs.map(toDuckDbRunRow)),
    writeJsonFile(toolUsagePath, sanitized.toolUsage.map(toDuckDbToolUsageRow)),
    writeJsonFile(verificationUsagePath, sanitized.verificationUsage.map(toDuckDbVerificationUsageRow)),
    writeJsonFile(backendErrorsPath, sanitized.backendErrors.map(toDuckDbBackendErrorRow)),
  ]);

  return { runsPath, toolUsagePath, verificationUsagePath, backendErrorsPath };
}

async function openDuckDb(dbPath: string) {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();
  return { instance, connection };
}

async function closeDuckDb(instance: unknown, connection: unknown): Promise<void> {
  const connectionWithClose = connection as { disconnectSync?: () => void };
  const instanceWithClose = instance as { closeSync?: () => void };
  connectionWithClose.disconnectSync?.();
  instanceWithClose.closeSync?.();
}

async function runStatements(connection: { run: (sql: string) => Promise<unknown> }, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await connection.run(statement);
  }
}

function runsTableSchema(): string {
  return `
CREATE TABLE runs (
  run_id VARCHAR,
  task_group_id VARCHAR,
  session_path_hash VARCHAR,
  status VARCHAR,
  scored BOOLEAN,
  started_at TIMESTAMP,
  started_day DATE,
  updated_at TIMESTAMP,
  finalized_at TIMESTAMP,
  finalization_reason VARCHAR,
  resolution VARCHAR,
  satisfaction DOUBLE,
  model_id VARCHAR,
  thinking_level VARCHAR,
  mixed_model_config BOOLEAN,
  mixed_treatment_config BOOLEAN,
  experiment_assignment VARCHAR,
  prompt_family VARCHAR,
  prompt_hash_prefix VARCHAR,
  tool_set_hash_prefix VARCHAR,
  skill_set_hash_prefix VARCHAR,
  selected_tool_count INTEGER,
  skill_count INTEGER,
  context_file_count INTEGER,
  prompt_guideline_count INTEGER,
  send_count INTEGER,
  assistant_turn_count INTEGER,
  assistant_turn_duration_ms BIGINT,
  busy_duration_ms BIGINT,
  busy_period_count INTEGER,
  interrupted_count INTEGER,
  message_edit_count INTEGER,
  truncated_after_count INTEGER,
  backend_error_count INTEGER,
  context_tokens BIGINT,
  context_limit BIGINT,
  filesystem_path_ref_count INTEGER,
  image_input_count INTEGER,
  image_input_bytes BIGINT,
  unsupported_input_count INTEGER,
  input_kinds_used VARCHAR[],
  tool_call_count INTEGER,
  tool_failure_count INTEGER,
  subagent_call_count INTEGER,
  subagent_task_count INTEGER,
  subagent_agent_count INTEGER,
  verification_total_count INTEGER,
  verification_failure_count INTEGER,
  verification_state VARCHAR,
  verification_count_bucket VARCHAR,
  verification_test_count INTEGER,
  verification_build_count INTEGER,
  verification_lint_count INTEGER,
  verification_typecheck_count INTEGER,
  verification_format_count INTEGER,
  verification_other_count INTEGER,
  file_write_count INTEGER,
  file_edit_count INTEGER,
  file_delete_count INTEGER,
  file_rename_count INTEGER,
  touched_file_count INTEGER,
  line_additions BIGINT,
  line_deletions BIGINT,
  line_modifications BIGINT,
  line_mutation_total BIGINT
);
`.trim();
}

function toolUsageTableSchema(): string {
  return `
CREATE TABLE tool_usage (
  run_id VARCHAR,
  tool_name VARCHAR,
  call_count INTEGER,
  failure_count INTEGER,
  started_at TIMESTAMP,
  started_day DATE,
  model_id VARCHAR,
  thinking_level VARCHAR,
  experiment_assignment VARCHAR,
  mixed_treatment_config BOOLEAN,
  scored BOOLEAN,
  satisfaction DOUBLE,
  resolution VARCHAR
);
`.trim();
}

function verificationUsageTableSchema(): string {
  return `
CREATE TABLE verification_usage (
  run_id VARCHAR,
  kind VARCHAR,
  count INTEGER,
  run_had_any_failure BOOLEAN,
  started_at TIMESTAMP,
  started_day DATE,
  model_id VARCHAR,
  thinking_level VARCHAR,
  experiment_assignment VARCHAR,
  mixed_treatment_config BOOLEAN,
  scored BOOLEAN,
  satisfaction DOUBLE,
  resolution VARCHAR
);
`.trim();
}

function backendErrorsTableSchema(): string {
  return `
CREATE TABLE backend_errors (
  run_id VARCHAR,
  error_code VARCHAR,
  count INTEGER,
  started_at TIMESTAMP,
  started_day DATE,
  model_id VARCHAR,
  thinking_level VARCHAR,
  experiment_assignment VARCHAR,
  scored BOOLEAN,
  satisfaction DOUBLE,
  resolution VARCHAR
);
`.trim();
}

async function populateTableFromJson(connection: { run: (sql: string) => Promise<unknown> }, tableName: string, schemaSql: string, sourcePath: string): Promise<void> {
  await runStatements(connection, [
    `DROP TABLE IF EXISTS ${tableName};`,
    schemaSql,
  ]);

  const rawRows = JSON.parse(await fs.readFile(sourcePath, 'utf8')) as unknown[];
  if (rawRows.length === 0) {
    return;
  }

  await connection.run(`INSERT INTO ${tableName} SELECT * FROM read_json_auto(${sqlStringLiteral(sourcePath)});`);
}

async function createDerivedViews(connection: { run: (sql: string) => Promise<unknown> }): Promise<void> {
  await runStatements(connection, [
    'DROP VIEW IF EXISTS outcomes;',
    'DROP VIEW IF EXISTS run_factors;',
    'DROP VIEW IF EXISTS subagent_usage;',
    'DROP VIEW IF EXISTS file_mutation;',
    `
CREATE VIEW outcomes AS
SELECT
  run_id,
  task_group_id,
  resolution,
  satisfaction,
  COALESCE(finalized_at, updated_at) AS recorded_at
FROM runs
WHERE scored = TRUE AND resolution IS NOT NULL;
`.trim(),
    `
CREATE VIEW run_factors AS
SELECT
  run_id,
  prompt_family,
  prompt_hash_prefix,
  tool_set_hash_prefix,
  skill_set_hash_prefix,
  selected_tool_count,
  skill_count,
  context_file_count,
  prompt_guideline_count
FROM runs;
`.trim(),
    `
CREATE VIEW subagent_usage AS
SELECT
  run_id,
  subagent_call_count,
  subagent_task_count,
  subagent_agent_count
FROM runs;
`.trim(),
    `
CREATE VIEW file_mutation AS
SELECT
  run_id,
  file_write_count AS write_count,
  file_edit_count AS edit_count,
  file_delete_count AS delete_count,
  file_rename_count AS rename_count,
  touched_file_count,
  line_additions,
  line_deletions,
  line_modifications,
  line_mutation_total
FROM runs;
`.trim(),
  ]);
}

export async function buildDuckDbDatabase(params: {
  dbPath: string;
  exportsDir: string;
  sanitized: SanitizedAnalyticsData;
}): Promise<void> {
  await ensureDir(path.dirname(params.dbPath));
  const stagingPaths = await writeDuckDbStagingExports(params.exportsDir, params.sanitized);
  const { instance, connection } = await openDuckDb(params.dbPath);

  try {
    await populateTableFromJson(connection, 'runs', runsTableSchema(), stagingPaths.runsPath);
    await populateTableFromJson(connection, 'tool_usage', toolUsageTableSchema(), stagingPaths.toolUsagePath);
    await populateTableFromJson(connection, 'verification_usage', verificationUsageTableSchema(), stagingPaths.verificationUsagePath);
    await populateTableFromJson(connection, 'backend_errors', backendErrorsTableSchema(), stagingPaths.backendErrorsPath);
    await createDerivedViews(connection);
  } finally {
    await closeDuckDb(instance, connection);
  }
}

export async function readNamedQuerySql(name: NamedQuery): Promise<string> {
  return await fs.readFile(QUERY_FILE_BY_NAME[name], 'utf8');
}

export async function runDuckDbQuery(dbPath: string, sql: string): Promise<Array<Record<string, unknown>>> {
  const { instance, connection } = await openDuckDb(dbPath);
  try {
    const reader = await connection.runAndReadAll(sql);
    return reader.getRowObjectsJson() as Array<Record<string, unknown>>;
  } finally {
    await closeDuckDb(instance, connection);
  }
}

export async function runNamedDuckDbQuery(dbPath: string, name: NamedQuery): Promise<Array<Record<string, unknown>>> {
  return await runDuckDbQuery(dbPath, await readNamedQuerySql(name));
}
