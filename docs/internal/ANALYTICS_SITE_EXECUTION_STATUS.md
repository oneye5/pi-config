# Analytics Site Execution Status

Updated: 2026-05-14

## Working decisions

- Analytics storage is authoritative under `data/outcomes/<workspace-hash>/` via `extension/src/host/extension-host.ts` + `extension/src/host/stats-service.ts`.
- Legacy `usage-data` remains migration-only.
- `run-analytics.json` is a private source input only.
- Version 1 will ship as a standalone top-level `analysis/` package.
- Analysis scripts will support explicit `--export <path>` input first.
- The stale `exportRunAnalytics` webview message has been removed; any future webview export UX must define a sanitized output contract explicitly.
- The tracked `settings.json` / README / installer sessionDir drift is reconciled on `data/outcomes/sessions`.
- First dashboard implementation will use local bundled Vega/Vega-Lite assets, no CDN.
- DuckDB is shipped via `@duckdb/node-api` in the standalone analysis package.
- The dashboard is a static localhost-served site with local bundled Vega/Vega-Lite assets and shared filters.
- Unexpected JSON files under `analysis/site/data/` fail validation and are not served by the local dashboard server.

## Implementation slices

1. ✅ Repo drift cleanup (`settings.json`, README/docs, protocol drift).
2. ✅ `analysis/` package scaffold.
3. ✅ Private source reader + sanitization + fixture.
4. ✅ Site-data generators + validation.
5. ✅ DuckDB model + SQL query runner.
6. ✅ Static dashboard + local serve/build.
7. ✅ Tests + smoke docs + full verification.
