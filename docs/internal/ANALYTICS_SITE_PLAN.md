# Interactive Run Analytics Site Plan

## Status

Drafted: 2026-05-13  
Audience: future implementation agents and the project owner  
Scope: planning only; no implementation is implied by this document.

## Executive summary

A basic HTML analytics site is a good fit for this project if it is treated as a **human-facing view over a stable local analytics model**, not as a second source of truth.

Recommended architecture:

```text
Existing local run analytics JSONL/checkpoints
        ↓
Explicit analysis/query/export boundary
        ↓
DuckDB-derived analytical model
        ↓
Generated chart-ready JSON files
        ↓
Static interactive HTML site
```

The first version should be a **static local dashboard** generated from the existing run analytics store. The site should load precomputed JSON datasets and render interactive charts in the browser. This gives humans filtering, charting, and drill-down affordances while keeping the core system agent-friendly, local-first, privacy-conscious, and easy to verify.

Do **not** start with a browser directly querying raw analytics files or a long-lived local server. Those are useful future options, but they add complexity before the right analytical questions and chart shapes are proven.

## Goals

1. Give humans an interactive way to inspect personal pi performance data.
2. Preserve the existing analytics principles:
   - runs are the analytical unit,
   - local-first storage,
   - structured data by default,
   - no raw transcript persistence in analysis exports by default,
   - no raw tool payload persistence in analysis exports by default.
3. Give agents a stable, textual, deterministic analysis surface.
4. Avoid notebook-style hidden state and noisy diffs as the primary medium.
5. Make common comparisons easy:
   - model and thinking-level effectiveness,
   - prompt/tool/skill treatment comparisons,
   - verification activity versus outcome,
   - tool/subagent usage and failure rates,
   - file-mutation volume versus outcome,
   - timeline trends.
6. Keep implementation incremental enough that the first useful dashboard can ship without redesigning the extension.

## Non-goals

- Do not create a cloud analytics service.
- Do not upload personal run data.
- Do not store or visualize raw transcripts by default.
- Do not store or visualize raw tool input/result payloads by default.
- Do not make notebooks the canonical analysis medium.
- Do not make the HTML site authoritative for analytics state.
- Do not migrate the existing append-only JSONL store unless a separate migration plan justifies it.
- Do not grow already-large extension files when new analysis modules can be split out.

## Current repository facts to preserve

### Existing analytics storage

The implemented analytics system is centered on `StatsService` and the run snapshot schema:

- `extension/src/host/stats-service.ts`
- `extension/src/host/run-analytics-types.ts`
- `extension/src/host/run-analytics-query.ts`
- `extension/src/backend/session-analytics.ts`
- `extension/src/shared/tool-call-analysis.ts`
- `extension/src/shared/protocol.ts`

Current persisted artifacts include:

- `run-snapshots.jsonl`
- `outcome-history.jsonl`
- `open-runs.a.json`
- `open-runs.b.json`
- `open-runs.gen`
- `run-analytics.json`

The query/export boundary already exists in `extension/src/host/run-analytics-query.ts`:

- `queryRunAnalyticsStore(storageDir)`
- `exportRunAnalyticsStore(storageDir, targetPath)`

That boundary should be reused or mirrored rather than having the dashboard scrape internal state or rendered UI.

### Captured analytical fields

The current `RunSnapshot` schema already contains high-value chart inputs:

- run/session/task IDs,
- status and finalization reason,
- outcome,
- model ID,
- thinking level,
- mixed treatment flags,
- treatment change kinds,
- experiment assignment,
- prompt/tool/skill analytics factors,
- send and assistant-turn counts,
- assistant/busy duration rollups,
- interruption/edit/truncate/backend-error counts,
- context token usage,
- composer input counts,
- tool usage rollups,
- subagent usage rollups,
- file mutation rollups,
- verification command rollups.

This is enough for a useful first dashboard without adding raw transcript access.

### Known implementation drift and blockers to resolve before implementation

Implementation agents should resolve these before hardcoding paths or shipping a dashboard:

1. Some docs say analytics are under `data/outcomes/usage-data/<workspace-hash>/`, while current code writes under `data/outcomes/<workspace-hash>/` and only migrates a legacy `usage-data` layout.
2. Root `README.md` says tracked `settings.json` points session history at `data/outcomes/sessions`, while the actual tracked `settings.json` currently uses `data/sessions`.
3. `extension/src/shared/protocol.ts` includes an `exportRunAnalytics` webview message type, but the current host message switch does not appear to handle it.
4. The extension auto-export file `run-analytics.json` is a private source export containing raw `RunSnapshot` objects, including `sessionPath` and possibly raw `analyticsFactors.contextFiles[].path` values. It must never be copied directly into `analysis/site/data/` or treated as shareable dashboard data.

The implementation should identify the actual authoritative runtime path and update docs only where necessary. Do not paper over the mismatch by adding a third path convention.

Before any webview-driven analytics export UX ships, resolve the `exportRunAnalytics` protocol drift one way or the other: implement the host handler with a clearly sanitized output contract, or remove/rename the stale protocol variant so no UI expects a no-op export path.

## Recommended medium

Use **DuckDB + generated JSON + static HTML**.

### Why DuckDB

DuckDB is a strong fit because it is:

- local-first,
- fast on JSON/Parquet/CSV-scale personal analytics,
- SQL-friendly for agents,
- scriptable from Node and Python,
- easy to use from CLI commands,
- good for repeatable analytical transformations,
- compatible with later export to Parquet if needed.

The dashboard itself does not need to query DuckDB directly in version 1. DuckDB should produce chart-ready JSON datasets that the site loads.

### Why static generated JSON

Generated JSON keeps the first dashboard simple:

- no application backend required,
- fewer VS Code/webview security concerns,
- easy to inspect with agents,
- easy to diff when using sample fixtures,
- no browser access to private raw analytics files,
- stable contract between analysis and visualization.

The tradeoff is that the dashboard updates after regeneration, not live. That is acceptable for version 1.

Important browser-delivery decision: version 1 should be served by a documented local static server command, not opened directly with `file://`. Most browsers block `fetch()` from loading sibling JSON files on `file://`, so "just open `index.html`" is unreliable unless the implementation generates a fully self-contained HTML file with inlined data and assets. Prefer `npm run serve` for version 1; consider self-contained HTML as a later export mode.

### Why basic HTML site

A basic HTML site is human-friendly and can be served from a small localhost dev server or later embedded in a VS Code webview. It also lets the project use interactive chart libraries without contaminating the canonical analytics store.

Preferred charting options:

1. **Vega-Lite**: best for declarative chart specs that agents can safely modify.
2. **Observable Plot**: excellent analytical charts and concise code, but may require more bespoke JavaScript.
3. **Apache ECharts**: good dashboard interactions, heavier and more dashboard-oriented.
4. **Plotly**: very interactive, but heavier and often more complex than needed.

Recommendation: start with **Vega-Lite** or **Observable Plot**. If the priority is agent-editable chart specs, choose Vega-Lite.

Chart dependencies must be installed, pinned, and bundled or served locally by default. Do not load chart libraries from a CDN when using private local analytics data. CDN loading may be acceptable only for a clearly documented demo mode using sanitized fixtures, ideally with subresource integrity and no private data.

## Proposed directory structure

Create a new top-level analysis area rather than putting this inside `extension/src/` immediately:

```text
analysis/
  README.md
  package.json
  tsconfig.json
  data/
    usage.duckdb              # generated, gitignored
    exports/                  # generated, gitignored
  fixtures/
    small-run-analytics.json  # sanitized committed test fixture
  queries/
    001_core_runs.sql
    model_quality.sql
    verification_impact.sql
    tool_usage.sql
    treatment_comparison.sql
    timeline.sql
  scripts/
    build-db.ts
    build-site.ts
    export-site-data.ts
    serve-site.ts
    validate-site-data.ts
  site/
    index.html
    app.ts
    style.css
    data/                     # generated, gitignored except optional sample data
      manifest.json
      overview.json
      model-quality.json
      verification-impact.json
      tool-usage.json
      treatment-comparison.json
      timeline.json
  test/
    analysis-transform.test.ts
```

Add gitignore entries for generated/private analysis output:

```text
analysis/data/*.duckdb
analysis/data/*.duckdb.*
analysis/data/exports/
analysis/site/data/*.json
!analysis/site/data/sample-*.json
```

If the implementation later embeds the dashboard inside the VS Code extension, keep the reusable analysis transforms separate from the webview bundle.

## Data flow

### Phase 1 data flow

```text
StatsService JSONL/checkpoint files
  -> query/export function or file reader
  -> normalized DuckDB tables/views
  -> chart-specific SQL queries
  -> generated JSON datasets
  -> static HTML dashboard
```

The HTML site should not need to know how `StatsService` checkpoints work. It should only know the versioned site-data JSON contract.

### Future data flow options

After the static dashboard proves useful, consider either:

1. **DuckDB-WASM in browser**
   - Useful for ad hoc client-side SQL.
   - More complex bundle and file-access story.
   - Should still use privacy-filtered exports, not raw transcripts.

2. **Local Node server**
   - Useful for live refresh and richer querying.
   - Increases security and lifecycle surface.
   - Should bind only to localhost and avoid exposing raw data by default.

3. **VS Code webview integration**
   - Useful once the dashboard is stable.
   - Requires CSP/resource-root/build-script work.
   - Should probably be a command or secondary panel, not clutter in the chat sidebar.

## Analysis data contracts

### Source export contract

The first implementation should consume the existing `RunAnalyticsExportPayload` shape, either by:

1. calling `exportRunAnalyticsStore(...)` from a script, or
2. reading an explicitly supplied `run-analytics.json` source export.

Do not implicitly pick up whatever `run-analytics.json` happens to exist without telling the user. If a script supports an existing export file, require an explicit `--export <path>` argument and print the source `exportedAt` timestamp. If freshness matters, prefer regenerating from `--storage-dir`; otherwise treat `--export` as a deliberate snapshot selected by the user.

Preferred approach: create a small shared CLI/script that uses `queryRunAnalyticsStore(storageDir)` or equivalent parsing logic. Avoid duplicating checkpoint and JSONL parsing in multiple places.

Minimum source payload fields:

```ts
interface SourceAnalyticsPayload {
  schemaVersion: number;
  exportedAt: string;
  workspaceKey: string;
  completedRuns: RunSnapshot[];
  openRuns: RunSnapshot[];
  outcomes: OutcomeHistoryLogEntry[];
}
```

### Derived table model

Create logical tables/views in DuckDB. The exact physical strategy can be views over JSON import or materialized tables; favor whatever is easiest to verify.

#### `runs`

One row per run snapshot.

Suggested columns:

- `run_id`
- `task_group_id`
- `session_path_hash`
- `status`
- `scored`
- `started_at`
- `updated_at`
- `finalized_at`
- `finalization_reason`
- `model_id`
- `thinking_level`
- `mixed_model_config`
- `mixed_treatment_config`
- `experiment_assignment`
- `send_count`
- `assistant_turn_count`
- `assistant_turn_duration_ms`
- `busy_duration_ms`
- `busy_period_count`
- `interrupted_count`
- `message_edit_count`
- `truncated_after_count`
- `context_tokens`
- `context_limit`
- `filesystem_path_ref_count`
- `image_input_count`
- `image_input_bytes`
- `unsupported_input_count`

Do not expose raw `sessionPath` by default in site data. Use a stable hash or omit it.

#### `outcomes`

One row per scored outcome.

Suggested columns:

- `run_id`
- `task_group_id`
- `resolution`
- `satisfaction`
- `recorded_at`

#### `run_factors`

One row per run with hashed treatment factors.

Suggested columns:

- `run_id`
- `prompt_family`
- `prompt_hash`
- `tool_set_hash`
- `skill_set_hash`
- `selected_tool_count`
- `skill_count`
- `context_file_count`
- `prompt_guideline_count`

Keep full skill names only if they are considered acceptable local-only metadata. For shareable exports, include only hashes/counts unless the user explicitly opts in.

#### `tool_usage`

Explode tool count maps into one row per run/tool name.

Suggested columns:

- `run_id`
- `tool_name`
- `call_count`
- `failure_count`

Also include run-level subagent fields either here or in `subagent_usage`.

#### `subagent_usage`

Suggested columns:

- `run_id`
- `subagent_call_count`
- `subagent_task_count`
- `subagent_agent_count`
- optional `agent_name` rows for local-only views.

#### `verification_usage`

One row per run/verification kind.

Suggested columns:

- `run_id`
- `kind` (`test`, `build`, `lint`, `typecheck`, `format`, `other`)
- `count`
- `failure_count`

Current snapshots expose total verification failures, not necessarily failures by kind. If per-kind failure counts are unavailable, document that limitation and avoid charts implying otherwise.

#### `file_mutation`

One row per run.

Suggested columns:

- `run_id`
- `write_count`
- `edit_count`
- `delete_count`
- `rename_count`
- `touched_file_count`
- `line_additions`
- `line_deletions`
- `line_modifications`

#### `backend_errors`

One row per run/error code.

Suggested columns:

- `run_id`
- `error_code`
- `count`

### Site-data JSON contract

Generate small, chart-specific JSON files rather than one giant dump.

#### `manifest.json`

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-13T00:00:00.000Z",
  "sourceWorkspaceKey": "3221b0ae5d308fe3",
  "sourceExportedAt": "2026-05-13T00:00:00.000Z",
  "completedRunCount": 0,
  "openRunCount": 0,
  "scoredRunCount": 0,
  "privacyMode": "local-default"
}
```

#### `overview.json`

Purpose: top-level KPIs and trend summaries.

Suggested fields:

- total completed runs,
- scored runs,
- open runs,
- average satisfaction,
- resolution counts,
- median busy duration,
- verification run rate,
- tool failure rate,
- latest run timestamp.

#### `model-quality.json`

Purpose: model/thinking comparison.

Rows should be aggregated by:

- `modelId`,
- `thinkingLevel`,
- optional `experimentAssignment`,
- run count,
- scored run count,
- average satisfaction,
- resolution distribution,
- median/average busy duration,
- average tool failures,
- verification rate.

#### `verification-impact.json`

Purpose: see whether verification correlates with better outcomes.

Rows should include:

- verification kind,
- count bucket,
- failure flag,
- scored run count,
- average satisfaction,
- resolution distribution.

#### `tool-usage.json`

Purpose: tool and subagent usage/failure analysis.

Rows should include:

- tool name,
- call count,
- failure count,
- affected run count,
- average satisfaction for runs using tool,
- average satisfaction for runs not using tool,
- subagent-specific groupings.

Be careful: these are correlations, not causal claims.

#### `treatment-comparison.json`

Purpose: prompt/tool/skill/experiment comparison.

Rows should include:

- prompt family,
- prompt hash prefix,
- tool set hash prefix,
- skill set hash prefix,
- experiment assignment,
- mixed treatment flag,
- run count,
- average satisfaction,
- resolution counts.

Only show hash prefixes in the UI by default.

#### `timeline.json`

Purpose: temporal analysis.

Rows should include:

- date/time bucket,
- run count,
- scored run count,
- average satisfaction,
- model mix,
- verification count,
- tool failure count,
- busy duration.

## Dashboard UX plan

### UX principles

- Keep it local and explicit without leaking raw paths: show generated timestamp and a privacy-safe workspace/export identifier, not raw source file paths.
- Separate fact from interpretation: charts show measurements, copy should avoid causal overclaiming.
- Make privacy visible: explain that raw transcripts/tool payloads are not included by default.
- Use filters consistently across charts.
- Prefer simple charts over dense dashboards.
- Give every chart an adjacent explanation of what it can and cannot prove.

### First-page layout

```text
Header
  - title: pie run analytics
  - generated timestamp
  - source workspace key or export ID; no raw local path
  - refresh/regenerate instructions

Filter bar
  - date range
  - model
  - thinking level
  - experiment assignment
  - scored only / include unscored
  - pure treatments only / include mixed

Overview cards
  - completed runs
  - scored runs
  - avg satisfaction
  - resolution rate
  - verification rate
  - tool failure rate

Tabs or sections
  1. Overview timeline
  2. Model quality
  3. Verification
  4. Tools and subagents
  5. Treatments
  6. Data notes
```

### Initial chart set

1. **Satisfaction over time**
   - line or point chart,
   - colored by model,
   - filterable by scored/pure treatment.

2. **Model quality matrix**
   - bar or dot plot,
   - grouped by model and thinking level,
   - show run count to prevent overreading tiny samples.

3. **Resolution distribution by model**
   - stacked bars,
   - emphasizes completed/fixed/partial/failed style outcome categories.

4. **Verification impact**
   - compare runs with no verification, passing verification, and failed verification,
   - show satisfaction and resolution distribution.

5. **Tool failure rate**
   - table plus bar chart,
   - sorted by failure rate with minimum call-count threshold.

6. **Subagent usage versus outcome**
   - compare runs with and without subagent calls,
   - show sample counts prominently.

7. **Treatment purity**
   - pure versus mixed treatment outcomes,
   - useful when evaluating experiment assignments.

### Drill-down behavior

Version 1 drill-down should remain privacy-safe:

- clicking a chart segment filters other charts,
- tables can show run IDs and timestamps,
- raw session paths are hidden by default,
- no transcript preview,
- no raw tool payload preview.

Later, a local-only advanced mode could provide links back to the VS Code session or raw files, but that should be explicit and opt-in.

## Agent-facing workflow

Agents should be able to perform deterministic analysis without opening a browser.

Recommended commands:

```bash
cd analysis
npm run build-db
npm run export-site-data
npm run validate-site-data
npm run build-site
npm run serve
```

Potential root-level convenience commands:

```bash
npm run analysis:build
npm run analysis:site
npm run analysis:validate
```

If no root `package.json` exists, keep commands in `analysis/package.json` and document them in `analysis/README.md`.

### Agent analysis loop

1. Run export/build command.
2. Run a named SQL query from `analysis/queries/`.
3. Inspect generated JSON with a bounded read.
4. Update report/chart/query files.
5. Run validation tests.
6. Summarize findings with caveats.

### Human analysis loop

1. Run one command to regenerate the dashboard data.
2. Run the documented local server command, for example `cd analysis && npm run serve`.
3. Open the localhost URL printed by the server.
4. Use filters and charts to inspect patterns.
4. If a chart suggests a workflow improvement, encode the hypothesis as an experiment assignment.
5. Revisit after enough scored runs have accumulated.

## Implementation phases

### Phase 0 — settle contracts and drift

Purpose: avoid building on ambiguous paths or stale docs.

Tasks:

1. Confirm the authoritative analytics storage path in current runtime code.
2. Decide whether the analysis scripts should read:
   - a user-supplied `--storage-dir`,
   - the repo-local default under `data/outcomes/<workspace-hash>`,
   - an exported `run-analytics.json`,
   - or all of the above.
3. Explicitly classify `run-analytics.json` as private source input. Do not place it under `analysis/site/data/` or expose it through the dashboard server as a site asset.
4. Decide whether a separate sanitized export command/file is needed, rather than relying on the raw auto-export.
5. Resolve the stale `exportRunAnalytics` protocol path before any webview export UI is built: implement a sanitized handler or remove/rename the protocol variant.
6. Update stale docs only where necessary.
7. Document the privacy policy for site-data exports.

Acceptance criteria:

- A future agent can identify where source analytics data comes from without reading `StatsService` internals.
- No new path convention is introduced accidentally.
- No plan or script treats raw `run-analytics.json` as a shareable or browser-served artifact.
- The protocol-level export path is either implemented with sanitization or explicitly out of scope/removed before UI work depends on it.

### Phase 1 — analysis package skeleton

Purpose: create a place for analysis code that is independent of the VS Code extension bundle.

Tasks:

1. Create `analysis/README.md`.
2. Create `analysis/package.json` with scripts.
3. Create `analysis/tsconfig.json`.
4. Add generated outputs to `.gitignore`.
5. Add a sanitized fixture under `analysis/fixtures/`.

Suggested dependencies:

- `typescript`, if not reused from extension tooling,
- `tsx` for script execution,
- `esbuild` or another small bundler for `analysis/site/app.ts`,
- a small static-file server dependency or a minimal local Node server script,
- pinned local charting dependencies such as Vega-Lite/vega-embed or Observable Plot,
- DuckDB package choice after compatibility check:
  - `@duckdb/node-api`, or
  - `duckdb`, or
  - CLI-only DuckDB invocation if preferred.

Do not rely on CDN-hosted chart scripts for private local analytics data.

Acceptance criteria:

- `cd analysis && npm run validate-site-data` can run against a fixture.
- No private `data/` contents are committed.

### Phase 2 — source export reader

Purpose: ingest current run analytics without duplicating extension internals unnecessarily.

Tasks:

1. Implement a reader that accepts one of:
   - `--export path/to/run-analytics.json`, or
   - `--storage-dir path/to/analytics/storage`.
2. Validate `schemaVersion`.
3. Coerce missing optional fields safely.
4. Normalize run/outcome joins by `runId`.
5. Hash or omit sensitive fields such as `sessionPath`.
6. Drop, hash, or bucket raw context file paths from `analyticsFactors.contextFiles[].path` before any derived DB/site-data output.
7. Treat `run-analytics.json` as a private source file even when it is already aggregated.
8. Add a guard that refuses to use `run-analytics.json` itself as a site-data output file or copy it into `analysis/site/data/`.

Acceptance criteria:

- Fixture loads successfully.
- Invalid schema version fails with a clear error.
- Missing optional fields do not crash the export.
- Private raw transcript fields are not present in derived outputs.
- Raw session paths and raw context file paths are absent from generated site data by default.

### Phase 3 — DuckDB model and SQL queries

Purpose: create a stable agent-friendly analytical substrate.

Tasks:

1. Build `analysis/data/usage.duckdb` from source payload.
2. Create the logical tables/views listed above.
3. Add starter SQL queries:
   - `model_quality.sql`,
   - `verification_impact.sql`,
   - `tool_usage.sql`,
   - `treatment_comparison.sql`,
   - `timeline.sql`.
4. Add a simple query runner for agents.

Acceptance criteria:

- Queries run deterministically against the fixture.
- Each query has a short comment explaining the question it answers.
- Query outputs do not include raw transcript/tool payloads.

### Phase 4 — generated site-data JSON

Purpose: define the contract consumed by the static HTML site.

Tasks:

1. Implement `export-site-data.ts`.
2. Generate `manifest.json` plus chart-specific JSON files.
3. Validate output shapes with lightweight runtime checks.
4. Keep files small and chart-focused.
5. Include sample counts in every comparative dataset.

Acceptance criteria:

- Site-data generation works from fixture and local data.
- JSON schema/shape validation catches missing required fields.
- Comparative datasets include run counts.
- No source `sessionPath` appears in generated site data by default.
- No raw context file path appears in generated site data by default.
- Source export files are clearly documented as private inputs rather than shareable dashboard artifacts.
- Generation fails if the target site-data directory would receive raw `run-analytics.json` or any payload with top-level `completedRuns`/`openRuns` source arrays.

### Phase 5 — static dashboard

Purpose: deliver human interactive visualizations.

Tasks:

1. Implement `analysis/site/index.html`.
2. Implement `analysis/site/app.ts` or plain `app.js`.
3. Implement `analysis/site/style.css`.
4. Implement `build-site.ts` or equivalent bundling so TypeScript and chart libraries are served locally.
5. Choose a chart library and document why.
6. Load `site/data/manifest.json` and chart datasets over the documented local server, not `file://`.
7. Add global filters.
8. Add the initial chart set.
9. Add a data-notes/privacy section.

Acceptance criteria:

- Site opens through the documented localhost command.
- Charts render from generated JSON.
- Filters update at least the primary charts.
- Empty datasets render useful messages rather than broken charts.
- The UI clearly shows generated timestamp and sample counts.
- Browser devtools show no external CDN/network requests in private-data mode.

### Phase 6 — validation and regression tests

Purpose: make the analysis layer safe for iterative agent edits.

Tasks:

1. Add tests for source payload loading.
2. Add tests for site-data generation from fixture.
3. Add tests for privacy invariants:
   - no raw transcript fields,
   - no raw tool payload fields,
   - no raw session paths by default,
   - no raw context file paths by default,
   - fixture sentinel strings for private paths/prompts/payloads do not leak.
4. Add tests for edge cases:
   - no scored runs,
   - open runs only,
   - missing outcomes,
   - unknown model IDs,
   - unknown verification kinds,
   - mixed treatment runs.
5. Add a documented manual smoke test for the HTML site.

Acceptance criteria:

- `npm run test` or `npm run validate` passes in `analysis/`.
- The privacy/fail-fast guard runs as part of the normal test or validate command, so automation fails if raw source exports are copied into site data.
- Manual browser smoke instructions exist.
- Validation can run against sanitized fixtures without local private data.

### Phase 7 — optional VS Code integration

Purpose: decide whether the dashboard should become part of the extension UI.

Do this only after the standalone site is useful.

Options:

1. Add a command: `pie.openAnalyticsDashboard`.
2. Add a secondary webview panel, separate from the chat sidebar.
3. Reuse generated site data rather than querying raw stores from the webview.
4. Update CSP/resource roots/build script intentionally.

Acceptance criteria:

- Chat sidebar remains uncluttered.
- Webview CSP is explicit and restrictive.
- Extension build/test/typecheck pass.
- `AGENTS.md` build requirement is followed after any `extension/src/` edits.

## Privacy and safety model

### Default local mode

Default generated data may include:

- model IDs,
- thinking levels,
- tool names,
- skill names if already local and not sensitive,
- prompt/tool/skill hashes,
- run IDs,
- workspace key or export-local identifier,
- aggregate counts and durations,
- outcome resolution and satisfaction,
- aggregate input counts such as image count or filesystem-reference count.

Do not include raw source file paths or analytics storage directory paths in generated site data or dashboard labels. If the user needs provenance, show a hash, basename-free export ID, or instructions for where to look locally rather than embedding the path in JSON.

Default generated data must not include:

- raw transcripts,
- raw user prompts,
- raw assistant responses,
- raw tool input payloads,
- raw tool result payloads,
- image bytes,
- arbitrary file contents,
- raw session paths,
- raw context file paths from `analyticsFactors.contextFiles[].path`,
- raw file paths embedded in tool names, errors, labels, or future factors.

Treat `run-analytics.json` and `RunAnalyticsExportPayload` as private source inputs, not as sanitized dashboard data. Even though they avoid raw transcripts/tool payloads by design, they can still contain local paths and workspace-derived identifiers. The site-data generation step is the privacy boundary.

### Shareable/export mode

A future shareable mode should be stricter:

- omit workspace key or replace with a new export ID,
- omit skill names unless explicitly allowed,
- use hash prefixes only,
- bucket timestamps to day/week if desired,
- remove run IDs or replace with export-local IDs.

Do not implement shareable mode implicitly. It should be a named command/flag.

## Technical decisions to make during implementation

### DuckDB integration choice

Evaluate:

1. Node package support on the target Node version used by the project.
2. Native dependency install complexity on Windows.
3. Whether CLI DuckDB is easier and more reliable.
4. Whether generated JSON can be produced directly in TypeScript first, with DuckDB added after the contract stabilizes.

Pragmatic recommendation:

- If native DuckDB package install is smooth, use it.
- If not, start with TypeScript transforms plus SQL files as design docs, then add DuckDB once dependency friction is resolved.
- Do not block the first dashboard solely on DB package friction.

### Chart library choice

Choose based on maintainability:

- Vega-Lite if declarative specs and agent editability matter most.
- Observable Plot if concise analytical JavaScript matters most.
- ECharts if dashboard polish/interactions matter most.

Recommendation: use Vega-Lite for version 1 unless a proof-of-concept shows it fights the desired interactions.

Security/privacy requirement: whatever library is chosen must be pinned in `analysis/package.json` and bundled or served from local files. Private-data mode must not depend on CDN-hosted scripts, fonts, styles, or telemetry.

### Standalone site versus extension webview

Start standalone. Later embed if needed.

Rationale:

- avoids extension CSP/build complexity at the start,
- avoids cluttering the chat sidebar,
- can iterate with local files and fixture data,
- avoids relying on `file://` behavior for JSON loading,
- still leaves a clean path to webview integration.

## Versioning strategy

Use two schema versions:

1. Existing source analytics schema version: `RUN_ANALYTICS_SCHEMA_VERSION`.
2. New site-data schema version: start at `1`.

Every generated JSON file should include or be covered by a manifest with:

- site-data schema version,
- source analytics schema version,
- generated timestamp,
- source exported timestamp,
- source workspace key or privacy-safe substitute,
- generator version if useful.

When source schema changes, fail loudly unless the reader explicitly supports the new version.

## Verification plan

### Automated checks

At minimum:

```bash
cd analysis
npm run test
npm run validate-site-data
npm run build-site
```

If extension code is touched:

```bash
cd extension
npm run typecheck
npm run test
npm run build
```

### Manual checks

1. Generate site data from sanitized fixture.
2. Serve the dashboard through the documented localhost command.
3. Confirm all charts render.
4. Confirm empty-state behavior with a fixture containing no scored runs.
5. Run schema-aware privacy validation over generated site data:
   - forbidden raw transcript fields such as `markdown`, user/assistant text parts, or message arrays are absent,
   - forbidden raw media fields such as `dataBase64` are absent,
   - forbidden raw tool payload fields such as exact payload-bearing `input`/`result` properties are absent,
   - source-only fields such as `sessionPath` are absent,
   - raw `analyticsFactors.contextFiles[].path` values are absent or hashed,
   - raw analytics source paths/storage directory paths are absent from labels and metadata,
   - fixture sentinel strings that look like private paths, prompts, file contents, and tool payloads do not appear.
6. Do not ban every occurrence of the substring `input`; aggregate fields like `imageInputCount` or `filesystemPathRefCount` are legitimate analytics.
7. Confirm chart labels make correlation limitations clear.

## Risks and mitigations

### Risk: accidental private data exposure

Mitigation:

- use chart-specific exports,
- treat `run-analytics.json` as private source input, not browser/site data,
- add fail-fast validation that rejects raw source payloads in `analysis/site/data/`,
- privacy tests,
- omit raw paths/payloads by default,
- add explicit shareable/local mode labels.

### Risk: dashboard implies causality from sparse data

Mitigation:

- show run counts everywhere,
- hide or de-emphasize groups below a minimum sample size,
- label charts as correlations,
- preserve filters for pure versus mixed treatment runs.

### Risk: analysis path drifts from extension storage

Mitigation:

- use existing query/export code where possible,
- document source path resolution,
- resolve the `data/outcomes/<hash>` versus legacy `data/outcomes/usage-data/<hash>` docs before implementation,
- add tests against fixture payloads,
- avoid duplicating checkpoint parsing.

### Risk: stale export protocol creates a broken UI path

Mitigation:

- before any webview integration, implement the `exportRunAnalytics` host handler with sanitized output semantics, or remove/rename the stale protocol variant,
- do not build dashboard UX that depends on an unhandled protocol message,
- keep the first standalone dashboard on explicit CLI/local-server commands until this drift is resolved.

### Risk: DuckDB dependency friction

Mitigation:

- prototype with generated JSON transforms first if needed,
- keep SQL queries as independent files,
- allow CLI-based DuckDB as fallback.

### Risk: extension UI bloat

Mitigation:

- start standalone,
- only add VS Code command/webview after dashboard proves useful,
- do not integrate into the chat panel by default.

### Risk: generated data becomes another source of truth

Mitigation:

- mark site data as generated,
- gitignore private generated data,
- always retain existing JSONL/checkpoint files as canonical.

## Open questions

1. Should version 1 consume `run-analytics.json` only, or also locate the workspace analytics directory automatically?
2. Should skill names be visible by default in local dashboard data, or should only hashes/counts be shown?
3. Should the site be designed from the start for later VS Code webview embedding, or should it prioritize standalone browser development?
4. Which chart library best balances agent-editability and desired interactions?
5. Is DuckDB a hard requirement for version 1, or can it be introduced after TypeScript-generated site data proves the dashboard contract?

## Recommended first implementation slice

The smallest useful slice is:

1. `analysis/fixtures/small-run-analytics.json` with 5-10 sanitized runs.
2. `analysis/scripts/export-site-data.ts` that reads a source export and writes:
   - `manifest.json`,
   - `overview.json`,
   - `model-quality.json`,
   - `timeline.json`.
3. `analysis/site/index.html` with:
   - overview cards,
   - model quality chart,
   - satisfaction timeline,
   - data notes.
4. Privacy validation that generated JSON contains no forbidden raw fields or sentinel private values, while allowing aggregate input-count fields.
5. Documentation for how agents and humans run it through the local server command.

Add DuckDB and the fuller query set immediately after the first slice if dependency setup is smooth. If DuckDB setup is not smooth, keep the generated JSON contract and add DuckDB as Phase 3b.

## Final recommendation

Build a **standalone static HTML dashboard powered by generated JSON exports**, with **DuckDB as the analytical/query layer** and the existing run analytics JSONL/checkpoint files as the canonical source.

This gives the project the two affordances it needs without creating two competing systems:

- humans get interactive visualizations,
- agents get stable SQL/JSON/text workflows.

The key design rule is: **one canonical analytics source, multiple generated views**.
