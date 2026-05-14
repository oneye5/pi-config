# Transcript Windowing And Culling Plan

## Status

Drafted: 2026-05-14
Audience: implementation agent
Goal: eliminate long-session chat lag by making transcript transport, rendering, and caching windowed/virtualized without breaking existing streaming, edit, truncate, restore, and snapshot/patch invariants.

## Recommended library choice

- The webview is Preact-based (`extension/scripts/build.mjs`, `extension/tsconfig.json`).
- Start with `virtua` for the **outer transcript list only** if it works cleanly with the current webview stack.
- If `virtua` needs brittle React compatibility glue, switch to `@tanstack/virtual-core` and keep the markup/state fully owned by pie.
- Do **not** start with `react-virtuoso` as the primary path.

## Hard constraints

- Preserve `docs/STATE_CONTRACT.md` rules:
  - full snapshots are authoritative,
  - patches are only reliable while the webview is visible,
  - mutating actions always require explicit `sessionPath`.
- Page on **display `ChatMessage` rows**, not raw session entries.
- Keep the active streaming turn loaded at all times.
- Bound the active loaded window with an explicit message/byte budget; repeated paging must not let active-session memory grow without limit.
- Never delete history from the session file; cull only from DOM, webview state, and host memory.
- Do not grow already-large files further:
  - `extension/src/webview/panel/transcript.tsx`
  - `extension/src/host/session-service.ts`
  - `extension/src/backend/index.ts`

## Plan

### Phase 0 — contract and module extraction

Files:
- `extension/src/shared/protocol.ts`
- `docs/STATE_CONTRACT.md`
- New: `extension/src/backend/transcript-window.ts`
- New: `extension/src/host/transcript-window.ts`
- New: `extension/src/webview/panel/transcript-virtual-list.tsx` (or equivalent split)

Change:
- Add transcript window metadata alongside the loaded `transcript` array. Minimum fields:
  - `totalCount`
  - `loadedStart`
  - `loadedEnd`
  - `hasOlder`
  - `hasNewer`
  - `isPartial`
  - `hasUserMessages`
- Add a backend request for transcript paging, e.g. `session.loadTranscriptPage`, with direction support (`older`, `newer`, `latest`).
- Add webview→host messages for loading older transcript and jumping back to latest/newer transcript.
- Centralize initial budgets so they are tunable in one place. Good starting values:
  - tail window: ~100 display messages
  - older/newer page size: ~40 display messages
  - max loaded active window: ~200–250 display messages or equivalent byte budget
- Bump `PROTOCOL_VERSION`.
- Update `docs/STATE_CONTRACT.md` so “full snapshot” means “authoritative snapshot of the currently loaded window plus window metadata”, not “entire transcript”.

Acceptance:
- There is a single explicit contract for partial transcripts before implementation spreads across backend/host/webview.

### Phase 1 — backend display-transcript cache and page slicing

Files:
- `extension/src/backend/index.ts`
- `extension/src/backend/transcript.ts`
- New: `extension/src/backend/transcript-window.ts`

Change:
- Build and keep a per-session **display transcript cache** based on `mapTranscript(sessionManager.getBranch())`.
- `session.open`, `session.preload`, and `session.opened` should return only the **tail window** plus metadata, not the full display transcript.
- `session.loadTranscriptPage` should slice the cached display transcript in both directions and support a fast return-to-latest path.
- After truncate/edit, invalidate and rebuild the display cache, then return an authoritative tail window.
- Keep the current streaming turn inside the loaded window so existing patch flow still has a live target.

Acceptance:
- The backend no longer ships the full transcript to the host/webview on ordinary open/preload.

### Phase 2 — host transcript window state and inactive-tab eviction

Files:
- `extension/src/host/store.ts`
- `extension/src/host/session-service.ts`
- `extension/src/host/session-opened-transcript.ts`
- New: `extension/src/host/transcript-window.ts`

Change:
- Store transcript window metadata per session separately from the loaded message array.
- Make transcript reducers window-aware:
  - replace current window,
  - prepend an older page,
  - append/load newer pages or reset to latest,
  - preserve alias/current-turn state for the loaded range.
- Make `resolveSessionOpenedTranscript` window-aware so a busy `session.opened` refresh cannot clobber optimistic local user rows or the current streaming turn.
- Update preload/open logic so “transcript present” means “window loaded”, not “whole transcript loaded”.
- Add LRU/TTL eviction for inactive open tabs:
  - keep session summary/settings,
  - keep at most a small tail window or no transcript rows at all,
  - reload on focus/select.
- Clear new transcript-window state on close/invalidate.

Acceptance:
- Multiple open long sessions no longer retain full transcript arrays in host memory.

### Phase 3 — virtualized transcript UI and seamless paging

Files:
- `extension/src/webview/panel/panel.tsx`
- `extension/src/webview/panel/transcript.tsx`
- `extension/src/webview/panel/overlay.ts`
- New: `extension/src/webview/panel/transcript-virtual-list.tsx`

Change:
- Replace raw `transcript.map(...)` rendering with a virtualized outer list.
- Load older pages when the user nears the top.
- If the loaded active window exceeds the configured budget, cull far-away pages and leave explicit top/bottom gaps based on `hasOlder` / `hasNewer`.
- Preserve scroll position exactly when prepending older pages; use the virtualizer’s prepend/anchor support or an explicit message-id anchor. Do **not** reuse the current DOM-child anchor logic unchanged.
- Preserve current bottom auto-follow semantics only while the user is near bottom; otherwise show a “jump to latest” / “new messages” affordance.
- Persist reasoning/tool/subagent disclosure state outside row-local hooks, keyed by message/tool ids, so unmounted rows restore correctly.
- Memoize or lazily compute heavy row work for visible rows only:
  - markdown HTML
  - raw JSON export payload

Acceptance:
- Only visible rows + overscan are mounted, older-page prepends do not visibly jump, and the active loaded window stays bounded after repeated paging.

### Phase 4 — remove full-transcript assumptions from secondary UI

Files:
- `extension/src/webview/panel/ui.tsx`
- `extension/src/webview/panel/context-window-breakdown.ts`
- `extension/src/shared/protocol.ts`
- Possibly `extension/src/backend/index.ts`

Change:
- Stop deriving `hasUserMessages` by scanning the loaded transcript window; use metadata.
- Make context-window UI explicitly partial-aware:
  - exact used/remaining numbers may still come from `contextUsage`,
  - but contributor rows must not pretend the loaded window is the full transcript.
- Simplest safe v1: when `isPartial` is true, show totals/notes only and suppress misleading per-message contributor rows.

Acceptance:
- Composer and context UI stay correct when only part of the transcript is loaded.

### Phase 5 — verification

Files:
- New/updated tests under `extension/test/**`

Required checks:
- `cd extension && npm run typecheck`
- `cd extension && npm run test`
- `cd extension && npm run build`

Manual smoke checklist:
1. Open a long session: tail window renders quickly and remains responsive.
2. Scroll upward: older page loads without scroll jump.
3. Stream while scrolled away from bottom: no forced jump; “jump to latest” works.
4. Switch between several long open tabs: memory stays bounded and tabs rehydrate on demand.
5. Edit a loaded user message after paging: truncate/send still resolves to the authoritative tail snapshot.
6. Hide/show the webview during streaming: patch-gap recovery still lands on the correct snapshot.

## Adversarial review — holes checked before implementation

- **Hole: paging raw session entries would split merged assistant bubbles/tool results.**  
  Fix: page only after `mapTranscript(...)` has produced display `ChatMessage` rows.

- **Hole: virtualization would reset reasoning/tool/subagent disclosure state whenever a row unmounts.**  
  Fix: move disclosure state out of row-local `useState` and key it by message/tool id.

- **Hole: current prepend scroll logic depends on real DOM children and will break once most rows are unmounted.**  
  Fix: use virtualizer-native prepend anchoring or an explicit message-id anchor; do not reuse the current DOM-child algorithm blindly.

- **Hole: streaming patches could target a message that has been culled.**  
  Fix: always keep the active streaming turn in the loaded window; never evict it.

- **Hole: repeated load-older actions could still let the active session grow without limit.**  
  Fix: enforce a max loaded-window budget and cull far-away pages behind explicit `hasOlder` / `hasNewer` gaps.

- **Hole: once newer pages are culled, there must be a supported way back to the live tail.**  
  Fix: paging API and webview controls must support `newer` / `latest`, not only `older`.

- **Hole: partial transcripts would silently corrupt composer/context heuristics.**  
  Fix: add explicit metadata (`hasUserMessages`, `isPartial`) and make context UI partial-aware.

- **Hole: inactive open tabs currently preload and retain transcript data indefinitely.**  
  Fix: add explicit host-side eviction for inactive tab transcript windows.

- **Hole: truncate/edit after paging could leave stale page windows around newer messages that were removed.**  
  Fix: after truncate/edit, discard page windows and replace them with the authoritative tail window from backend.

- **Hole: a busy `session.opened` refresh could overwrite optimistic local rows or the in-progress streaming turn.**  
  Fix: make `resolveSessionOpenedTranscript` window-aware and preserve newer local/streaming state until the authoritative turn lands.

- **Hole: protocol/document drift would make snapshot semantics ambiguous.**  
  Fix: bump `PROTOCOL_VERSION` and update `docs/STATE_CONTRACT.md` in the same change.

- **Hole: the implementation could sprawl inside already-large files.**  
  Fix: extract backend/host/webview transcript-window modules first, then integrate.

- **Known limitation accepted for v1:** first open of a very large historical session may still require building the full display-transcript cache once in the backend.  
  This is acceptable for v1 if interactive lag is removed. If open latency remains high, add a follow-up for reverse tail-window mapping/indexing.
