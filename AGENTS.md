# AGENTS.md

Personal pi config stack: VS Code extension GUI ("pie"), custom pi extensions, agents, skills, and centralized settings.

## Structure

- `extension/` — VS Code extension (TypeScript + Preact webview)
- `extensions/` — Custom pi tools: `subagent` (delegate to isolated pi processes), `cwd-skills` (auto-discovers `skills/` in cwd), `skill-pruner` (NLP-based skill relevance scoring + prompt pruning)
- `agents/` — Agent definitions (worker, planner, reviewer, scout)
- `skills/` — Pi skills
- `settings.json` — Pi settings (model, sessionDir, packages) — tracked, don't commit local overrides
- `model-profiles.yaml` — Shared model registry: subagent eligibility + per-dimension scores. Read by both the `subagent` extension (for selection) and pie's model picker (for ordering + warnings). When missing, subagents inherit the caller's model and the picker shows models unranked.
- `APPEND_SYSTEM.md` — Appended to every agent system prompt
- `docs/` — Internal design docs; `STATE_CONTRACT.md` is authoritative for host↔webview sync
- `data/` — Git-ignored local runtime data (sessions, outcomes)

## Test convention

Use `npm run test` from the repo root as the **canonical** test command.

- It runs each package in isolation.
- It prints concise package summaries plus exact failing tests only.
- It enforces package-level line/branch coverage gates.
- Scope to one package with `npm run test -- --package <id>`.
- Available package ids: `extension`, `analysis`, `cwd-skills`, `safeguard`, `skill-pruner`, `subagent`.

Every package with tests has its own `test/` directory containing `*.test.ts` files,
co-located with the code under test. There is no shared top-level `test/` directory.

| Package | Test dir | Preferred runner |
|---|---|---|
| `extension/` | `extension/test/` | `npm run test -- --package extension` |
| `extensions/cwd-skills/` | `extensions/cwd-skills/test/` | `npm run test -- --package cwd-skills` |
| `extensions/safeguard/` | `extensions/safeguard/test/` | `npm run test -- --package safeguard` |
| `extensions/skill-pruner/` | `extensions/skill-pruner/test/` | `npm run test -- --package skill-pruner` |
| `extensions/subagent/` | `extensions/subagent/test/` | `npm run test -- --package subagent` |
| `analysis/` | `analysis/test/` | `npm run test -- --package analysis` |

Convenience wrappers still exist: `npm run extension:test`, `npm run extensions:test`, `npm run analytics:test`.

When adding a new test, place it in the `test/` directory of the package it tests.

## Extension build

**Always rebuild after editing `extension/src/`** — build auto-syncs output to the installed VS Code extension.

```bash
cd extension
npm run build      # build + sync
npm run watch      # incremental
npm run test       # unit tests
npm run typecheck  # type-check only
npm run package    # produce .vsix
```
