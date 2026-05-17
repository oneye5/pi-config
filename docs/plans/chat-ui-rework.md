# Chat UI Rework Plan

Audience: an implementation agent (worker). This plan rebuilds the **main chat surface** (tab header, transcript area, composer) of the `pie` VS Code extension webview. The current high‑level visual styling is in scope to preserve verbatim — only structure, state flow, and interaction mechanics change.

Source files in scope (verified line counts as of plan authorship):
- `extension/src/webview/panel/panel.tsx` (580 lines, god component)
- `extension/src/webview/panel/ui.tsx` (430 lines, Composer re‑export + composer height observer)
- `extension/src/webview/panel/stream-smoother.ts` (225 lines — feeds streaming deltas into the renderer; **must be reconciled with the per‑message signal rewrite, see §2.3.2**)
- `extension/src/webview/panel/auto-scroll.ts` (path is in `panel/`, not `transcript/`)
- `extension/src/webview/panel/transcript/*` — full set: `index.tsx`, `virtual-list.tsx` (227 lines), `virtual-list-row.tsx`, `virtual-list-rows.ts`, `message-item.tsx`, `tool-call-item.tsx` (348 lines), `tool-call-card.tsx`, `use-transcript-scroll.ts` (466 lines), `scroll-anchor.ts` (50 lines), `state.ts` (15 lines — currently just the `isTranscriptHydrating` helper), `parts.ts`, `header.ts`, `interactions.ts`, `subagent.ts`, `subagent-score-display.ts`, `use-disclosure-open.ts`, `types.ts`
- `extension/src/webview/panel/session-tabs/*` (3 files)
- `extension/src/webview/panel/composer/*` (already a subdirectory of ~7 files — `ui.tsx` re‑exports the entry point)
- `extension/src/webview/panel/context-window/*`, `file-drop/*`, `pruning-banner.tsx`, `run-outcome-dialog.tsx` (peripheral UI/helpers currently reached through `panel.tsx`; UI components should read store signals where appropriate, while pure helpers such as `file-drop/*` stay stateless).
- `extension/src/webview/panel/panel.css` (2777 lines, monolithic)
- `extension/src/shared/protocol.ts`, `extension/src/shared/tab-behavior.ts`, `docs/STATE_CONTRACT.md`, `extension/src/host/session-service/events.ts`, `extension/src/host/sidebar-provider.ts` — required context for host↔webview sync. **Important current reality:** `ViewState` exposes only the active session transcript; `PatchOp` does not include `sessionPath`; the host posts stream patches only for the active session (`events.ts` guards with `isActiveSession`). Persistent tabs must therefore be implemented as a webview-side per-session cache seeded from active snapshots/patches, not by assuming all open-tab transcripts arrive in every snapshot.
- `extension/scripts/build.mjs` — required context for CSS splitting. **Current reality:** webview CSS is copied as a static asset, not bundled by esbuild. Phase 7 must update the build script before introducing CSS `@import`s; runtime CSS imports are not acceptable.
- `extension/test/` — 75 `*.test.ts` files at current `HEAD`. They are Node test-runner tests; there is SSR-style webview rendering coverage (`webview-render.test.ts`) but no DOM mounting harness and no `jsdom`/`happy-dom`/`@testing-library/preact` dependency yet.

---

## 1. Diagnosis — Why the current UI is brittle

Each point below is grounded in code that exists today; the implementation agent should re‑read the cited file before starting that subsection.

### 1.1 No state layer — `panel.tsx` is a 580‑line god component
- All of: viewState, overlay, editingId, contextMenu, draftRestore, outcomeDialog, token rate, host revision tracking, pending draft restore map, host instance id — live as `useState`/`useRef` in `App()`.
- Every child receives 15–25 props. `ComposerView` takes 25 props; `TranscriptVirtualList` takes 18; both pass through to grandchildren.
- Consequence: trivial changes (e.g., add a new badge near the composer) require threading props through 3 layers. Agents repeatedly fail because they cannot find the single source of truth for a given piece of state.
- `@preact/signals` (`^2.9.0`) is **already in `extension/package.json`** but has **zero imports** anywhere in `extension/src/`. We are paying the install cost and getting none of the ergonomic benefit.

### 1.2 Tab switching remounts the entire transcript
- `panel.tsx` renders `<TranscriptView key={activeSessionPath ?? 'no-active-session'} ... />`.
- Effect: switching tabs throws away the virtualizer instance, the row size cache, the scroll position, every memoized markdown render, and every disclosure state (`useDisclosureOpen` keyed locally). Then `useTranscriptScroll` runs a 3‑frame RAF "initial bottom snap" (`INITIAL_BOTTOM_SNAP_FRAMES = 3` in `use-transcript-scroll.ts:33`) while the user watches the transcript shift.
- This is the single biggest source of "hitching when switching tabs."

### 1.3 The virtualizer is fighting the scroll hook
- `virtual-list.tsx` instantiates `@tanstack/virtual-core` correctly, but then:
  - `setOptions({...})` is invoked on **every render**, allocating new option objects and forcing the virtualizer to reconcile (`virtual-list.tsx:105–117`).
  - `initialOffset: () => Number.MAX_SAFE_INTEGER` is a hack to land at the bottom; combined with `use-transcript-scroll.ts` running its own `scrollToBottom` + RAF snap + smooth follow loop, there are **three independent systems** trying to control `scrollTop`.
  - `estimateTranscriptRowSize` returns 120 / 180 / 140 / 56 px — wildly off for real messages (often 600–2000 px). With thousands of rows this produces a phantom scrollbar that visibly jumps as rows measure in.
- `use-transcript-scroll.ts` is **466 lines**. It hand‑rolls: smooth follow, manual scroll intent debouncing (`MANUAL_SCROLL_INTENT_GRACE_MS = 280`), pointer/wheel/touch listeners, initial bottom snap RAF loop, older/newer page loading with 1.5s timeouts, anchor capture/restore, and auto‑follow heuristics in `auto-scroll.ts`. None of it is tested as a unit. Agents are afraid to touch it.

### 1.4 Re‑render storms during streaming
- `Overlay` is `{ partsByMessage: Map<string, ChatMessagePart[]> }`. Every `messageDelta` patch produces a new `Map` instance.
- `<TranscriptVirtualList>` receives `overlay` as a prop, passes it to every visible `<TranscriptVirtualRow>`, which passes it to every `<MessageItem>` regardless of whether that particular message is being streamed.
- `MessageItem` is wrapped in `memo`, but the `overlay` prop reference changes every keystroke of the model, so memo never short‑circuits for any visible row.
- During a verbose streaming response with 20 rows on screen, every visible row re‑runs `useMemo(renderMarkdown(...))`. Markdown rendering is the dominant cost.

### 1.5 Edit‑in‑place causes the message to change size
- `message-item.tsx` `InlineEditor`: when the user clicks a user message, the entire rendered `<div class="message-body" dangerouslySetInnerHTML>` is unmounted and replaced by a `<textarea>` whose height is `Math.min(scrollHeight, 240)px`.
- The textarea's intrinsic line‑height and padding differ from the rendered markdown's block layout (lists, code blocks, paragraphs collapse to plain text). Net effect: vertical position of the visible message shifts up or down by tens to hundreds of pixels. The user has to re‑find their place. (Exactly the complaint in the user's brief.)
- Action buttons appear **below** the textarea, also pushing layout.

### 1.6 Extensibility friction — adding a new row type or message kind is awkward
- A new row kind requires changes in **four** files: `virtual-list-rows.ts` (union + builder + estimator), `virtual-list-row.tsx` (dispatch), `virtual-list.tsx` (if it needs new props), and frequently `message-item.tsx`. Plus prop drilling from `panel.tsx`.
- There is no registry — every renderer is a hard‑coded `if (row.kind === ...)` branch.
- Tool call rendering (`tool-call-item.tsx`, 348 lines) hard‑codes per‑tool branches; adding a new tool means editing that file too.

### 1.7 CSS monolith
- `panel.css` = 2777 lines, all selectors flat. No way to know which rules belong to the composer vs transcript vs tabs without grep. Agents routinely break unrelated visuals.

### 1.8 Other smaller issues
- `panel.tsx:~199` — token rate computation runs inside the message event handler on every `messageDelta`. Should be offloaded.
- `panel.tsx:~294` — `useEffect` closes the outcome dialog when `activeSession?.path` changes; uses object‑property access in dep array which is fine but the effect runs on first mount unnecessarily.
- `ContextMenu` is mounted at panel root but its position is computed once; on window resize it goes off‑screen.
- `composer-height` CSS var is set via a `ResizeObserver` (`ui.tsx:~273`) — this is fine, but it's the only piece of imperative layout glue and is undocumented. Should be encoded in the layout primitive.

(Line numbers above are approximate — verify against current `HEAD` before relying on them; the cited *behaviors* are the contract, not the line numbers.)

---

## 2. Target architecture

### 2.1 Principles
1. **One state store**, signal‑based, observed at the leaf. Eliminate prop drilling.
2. **Persistent transcript instance per session**, not per‑mount. Tab switches show/hide; they do not remount.
3. **Single owner of scroll**: the virtualizer. Delete custom smooth-follow and RAF snap loops; use `scrollToIndex({ align: 'end' })` and stick-to-bottom state derived from virtual items/range measurements.
4. **Stable identity for streaming**: streaming state lives on a per‑message signal, not a global `Overlay` object. Non‑streaming rows never re‑render.
5. **Edit mode preserves bounding box**: edit happens in an overlay/popover keyed to the message's measured box, or in‑place with `contain: size` and a textarea that mirrors rendered height to the pixel.
6. **Registries, not switch statements**, for row kinds, message parts, and tool call renderers.
7. **CSS sharded by surface**, with CSS layers, so a change to `composer.css` cannot leak into `transcript.css`.

### 2.2 State management — `@preact/signals` (already installed)
Why signals over Zustand/Jotai/Redux:
- Already a dependency. No new dependency or install cost (importing it will still add its runtime code to the webview bundle).
- Preact has first‑class signals integration: a `signal.value` read inside a component subscribes that component **only**. This solves the "Overlay map identity change re‑renders the world" problem without manual memoization.
- Compatible with the existing `vscode.postMessage` reducer pattern: the host snapshot dispatches → reducer mutates signals → only affected components rerender.
- We do not need cross‑slice middleware, devtools, or async thunks; Zustand/Redux would be overkill.

Store shape (new files under `extension/src/webview/panel/store/`):
```ts
// One module family, exports signals + actions. No React context needed.
export const sessionsSig = signal<SessionSummary[]>([]);
// Host-committed active path from the latest accepted snapshot.
// Patch attribution MUST use this, not an optimistic tab-click target.
export const activeSessionPathSig = signal<string | null>(null);
// Optional UI/requested target used only for pending tab-click affordances.
export const requestedActiveSessionPathSig = signal<string | null>(null);
export const openTabPathsSig = signal<string[]>([]);
export const runningSessionPathsSig = signal<string[]>([]);
export const unreadFinishedSessionPathsSig = signal<string[]>([]);

// Per-session sub-stores, lazy-initialized and retained while the tab is open.
// Seeded from the active-session fields in ViewState whenever that session is active.
export const sessionStore = (path: string): SessionStore => ...;
//   .summarySig, .transcriptSig, .transcriptWindowSig, .busySig,
//   .systemPromptsSig, .contextUsageSig, .fileChangesSig, .pruningResultSig,
//   .pendingComposerInputsSig, .activeRunSummarySig,
//   .streamingPartsByMessageSig (Signal<Map<string, Signal<ChatMessagePart[]>>>),
//   .editingIdSig, .draftRestoreSig, .scrollSig, .measurementCache

export const prefsSig = signal<ChatPrefs>(DEFAULT_CHAT_PREFS);
export const globalUiSig = signal<{ contextMenu, outcomeDialog, notice }>;
export const hostMetaSig = signal<{ instanceId: string; revision: number; awaitingSnapshot: boolean }>;

// Actions (thin wrappers over postMessage; mutating actions require explicit sessionPath)
export const send = (sessionPath: string, text: string) => { ... };
export const requestEdit = (sessionPath: string, messageId: string) => { ... };
```

**Active-only protocol constraint**: do not change `ViewState` or `PatchOp` in this refactor. The store caches per-session data by copying `msg.state.transcript`, `transcriptWindow`, pending inputs, run summary, file changes, context usage, and system prompts into `sessionStore(activeSession.path)` on every full snapshot. Patches are attributed to the **last committed snapshot active path** (`activeSessionPathSig.value`) because `PatchOp` lacks `sessionPath`, matching current host behavior. Do not update that committed path optimistically on tab click; use a separate requested/transition signal if the UI needs pending-selection affordances. On host instance change, clear all session stores and request a fresh snapshot.

**Key design choice — streaming isolation**: rather than one global `Overlay`, each message has its own `signal<ChatMessagePart[]>` looked up by id. When a streaming patch is committed, only that inner signal mutates → only that one `<MessageItem>` re-renders. The outer `Map` signal changes only when an entry is created/deleted; inner part updates must not replace the outer map.

The `postMessage` reducer becomes a single function `applyHostMessage(msg)` in `store/dispatch.ts`. `panel.tsx` should become a small entry/listener/mount file; export the testable app shell from a separate module (for example `panel/app.tsx`) so tests do not import a module that calls `acquireVsCodeApi()` at top level.

### 2.3 Persistent transcripts per tab
- Replace `<TranscriptView key={activeSessionPath} />` with a `<TranscriptHost>` that renders one transcript surface per `openTabPaths` entry. Only the active surface is visible/interactive; inactive surfaces remain mounted but `aria-hidden`.
- Because the protocol exposes only the active transcript, each per-tab surface reads from `sessionStore(path)`. The store is seeded when that path becomes active; if a tab has never been hydrated, render the existing lightweight loading state until the host sends its first active snapshot.
- Each `<TranscriptView>` keeps its scroll element, virtualizer instance, row size cache, and disclosure state mounted across tab switches.
- Memory budget: typical workflow has 2–8 open tabs. Virtualized transcripts are O(open tabs × visible rows) in DOM cost, not O(total messages). Keep overscan conservative and dispose aggressively on close.
- Edge case: there is no explicit `session.cleanup` webview message today. On full snapshot apply, first migrate `__pending__:` placeholder stores to their resolved real path when the host replaces a pending tab, then dispose stores whose paths truly left `openTabPaths` (and dispose all stores on host instance changes).

### 2.3.1 Signals + markdown subscription — gotchas
- `@preact/signals@2.9.0` exports `signal`, `computed`, `batch`, `effect`, `useSignal`, `useComputed`, and `useSignalEffect`. It does **not** export `useSignalValue`. Components should read `sig.value` directly in render or use `useComputed` where a derived value is useful.
- `useMemo(() => renderMarkdown(parts), [parts])`: when `parts` comes from a signal, the read must happen inside the component body (or inside `useComputed`) so `@preact/signals` records the subscription. Reading `partsSig.peek()` will **not** subscribe → stale markdown. Convention: every signal read in this codebase uses `.value` at component scope or via `useSignal`/`useComputed` from `@preact/signals`.
- `dangerouslySetInnerHTML` is fine with signals: when the signal mutates, the component re-renders, `useMemo` re-evaluates because its `[parts]` dep changed, the new HTML string is passed in. No special handling needed.
- Wrap reducer mutations in `batch(() => { ... })` so multi-field patches produce one re-render per affected component, not N.
- **Two-level signal pattern** for per-message streaming: the outer store holds `streamingMapSig: signal<Map<string, Signal<ChatMessagePart[]>>>`. Components subscribe by reading `streamingMapSig.value` (to detect new message entries), then reading the inner signal (to detect content changes). Example: `const inner = store.streamingMapSig.value.get(id); const parts = inner?.value ?? [];` triggers re-render when either the map entry is created/deleted OR that message's parts change.
- **Do not replace the outer map on every token.** Create a new `Map` only when adding/removing a message entry. For normal token updates, mutate the inner signal (`inner.value = nextParts`) so non-target messages that read the outer map do not re-render.
- For per-message streaming signals: the `Map<string, Signal<ChatMessagePart[]>>` is keyed by message id, lazily created on first patch. On session-store disposal, clear the map and drop all inner signal references. Never hold a signal reference across session changes.

### 2.3.2 Stream smoother integration (REQUIRED — do not skip)
`extension/src/webview/panel/stream-smoother.ts` (225 lines) currently sits between raw `messageDelta` events and what the UI renders. Its job is to amortize bursty token arrival into a steady visual cadence. The per-message signal rewrite must **not** bypass it.

Integration contract:
1. Smoother input: raw streaming `PatchOp`s from `applyHostMessage` for the currently active session. This matches current host reality: `PatchOp` has no `sessionPath`, and `events.ts` posts patches only when `state.isActiveSession(sessionPath)` is true.
2. Smoother output: preserve the timing/batching logic, but replace the `Overlay` sink with a narrow sink interface, e.g. `commit(op: PatchOp): void` or `commit(messageId, updater): void`. The store wires the sink to the appropriate per-message signal write inside `batch(...)`.
3. Decoupling rule: `stream-smoother.ts` should not import `@preact/signals`. It may keep a default `Overlay` sink or compatibility helper for existing tests, but rendering should use the signal sink.
4. Lifecycle: each `SessionStore` may own a smoother, but only the host-committed active session's smoother receives patches. On host-confirmed active-session change, full snapshot, host-instance change, or terminal `clearOverlay`, flush/cancel pending deltas for the affected ids before clearing their streaming signals. This fixes a current edge case where `clearOverlay` can arrive while buffered deltas are still pending.
5. Existing `stream-smoother.test.ts` must keep covering the smoothing algorithm. If the public surface changes, update those tests in the same commit and add cases for: `messageThinking`, `toolCall`, `clearOverlay` with pending deltas, and active-session switch flush.

Do not delete or wholesale rewrite `stream-smoother.ts` in this rework. Extract or replace only its sink (Overlay → per-message signal) while retaining its timing behavior.

### 2.4 Virtualization — keep `@tanstack/virtual-core`, but use it correctly
- Keep one `Virtualizer` instance per mounted transcript surface. Since Phase 3 keeps a surface mounted per open tab, this already gives one instance per session without forcing DOM-owned lifecycle into a pure store.
- Preferred implementation shape: a tiny `useStableVirtualizer(sessionStore, options)` hook creates/attaches the `Virtualizer` once, calls `_didMount()`/`_willUpdate()` in layout effects (matching TanStack's own adapters), and stores only serializable state in `SessionStore` (measurement cache, scroll offset, `autoFollow`, disclosure state). Do **not** put raw DOM refs or observer lifecycles in a store constructor before the scroll element exists.
- `setOptions` only on actual option changes — wrap in a `useLayoutEffect`/`useEffect` keyed on specific values (`rows.length`, estimate function version, scroll element availability, overscan), not on every render.
- Replace the permanent `initialOffset: MAX_SAFE_INTEGER` hack with a controlled initial-bottom algorithm: use it only to avoid first-paint-at-top, then call `scrollToIndex(rows.length - 1, { align: 'end' })` after the first real measurement pass and disable the hack for subsequent updates.
- Tune `estimateSize`: persist measured sizes per `row.key` in `localStorage` (keyed by a hash of session path + message/row id, not raw absolute paths) so the next mount has a near-exact scrollbar.
- Stick-to-bottom: derive from the virtualizer's range/measurements — we are stuck to bottom iff the last virtual row is at/near `totalSize` AND the user has not scrolled away since the last frame. Drop the 466-line `use-transcript-scroll.ts` in favor of a small hook that owns only: "user scrolled up → autoFollow=false", "new committed content + autoFollow=true → scrollToIndex(end)", and pagination sentinels.

### 2.5 No‑layout‑shift inline editing
Two acceptable designs; the user's brief makes option A the clear winner:

**Option A — Mirror layout (chosen).**
- The edit `<textarea>` is laid out **inside** the same `<div class="message-body">` container and inherits its `font-family`, `font-size`, `line-height`, `padding`, and `width`.
- The rendered markdown's block container is measured via `ResizeObserver` while in read mode; the height is cached in the session store by message id. When swapping into edit mode, the container locks to `min-height: <captured>px` for the duration of the edit, so the message's bounding box cannot shrink.
- Textarea height-to-content: Chromium supports `field-sizing: content` starting at 123; VS Code 1.92 shipped Electron 30 / Chromium 124, while this extension declares `engines.vscode: ^1.80.0` and therefore must support older Chromium builds. Use progressive enhancement: set `field-sizing: content; min-height: <captured>px;` as the primary CSS path, and ship a JS fallback for unsupported engines. Gate fallback CSS with `@supports not (field-sizing: content)` and gate fallback JS with `CSS.supports?.('field-sizing', 'content') === false` (or equivalent feature detection). The fallback `useLayoutEffect` (not an input-handler-only resize loop) sets `height = 'auto'; height = scrollHeight + 'px'` after value changes. The fallback must ship regardless of the developer's local VS Code version.
- The captured `min-height` is the load-bearing guarantee for no-shift: even in the fallback path, even if a resize fires one frame late, the message cannot collapse. Because the floor is 1.80, the `field-sizing` + `@supports` progressive enhancement pattern ensures modern VS Code instances get native height management while older ones fall back gracefully.
- Edit affordances (Save/Cancel) render as an absolute‑positioned toolbar pinned to the bottom‑right of the message box, **not** as a new block below.
- **Growing while typing**: if the user types more than the original rendered height, the message naturally grows downward. Content **below** shifts; the message being edited and content **above** do not. This is the correct behavior per the brief — the user's eye stays on the text they were editing.
- Net behavior: clicking a user message swaps text↔textarea in place with zero shift. Subsequent typing only ever pushes content below.

**Option B — Sheet editor**, considered and rejected: a floating popover anchored to the message. Adds modality and breaks keyboard flow.

The implementation agent should also fix the related issue: today the message becomes a `<textarea>` with a min‑height tied to `scrollHeight` rather than the actual rendered height. After the rework, the editor never gets smaller than the rendered message and grows naturally as the user types.

### 2.6 Extensibility — row + part + tool registries
Create `extension/src/webview/panel/transcript/registry.ts`:
```ts
export interface RowRenderer<T extends TranscriptRow = TranscriptRow> {
  kind: T['kind'];
  estimate: (row: T) => number;
  render: (row: T, ctx: RenderCtx) => JSX.Element;
}
export const rowRegistry = new Map<string, RowRenderer>();
export const registerRow = (r: RowRenderer) => rowRegistry.set(r.kind, r);
```
Same pattern for `partRegistry` for current assistant `ChatMessagePart` kinds (text / reasoning / toolCall) and a separate `userPartRegistry` if needed for `UserContentPart` kinds (text / image). Do not invent new protocol part kinds in this refactor. Add `toolRegistry` for per-tool renderers.

**Build reality for registries:** module-load registration only works for modules that are imported by the static webview entry. There is no import-glob/discovery mechanism today. Add an explicit `transcript/register-builtins.ts` (or `registry-bootstrap.ts`) that imports every built-in row/part/tool renderer exactly once, and import that bootstrap from the transcript entry. Until a generated manifest exists, adding a new renderer is a small **two-file** change: the renderer module plus one bootstrap import. The dispatcher stays closed to new kinds.

### 2.7 CSS reorganization
Split `panel.css` (2777 lines) into:
```
panel/styles/
  tokens.css         (CSS vars, color tokens — already styled, just lift them)
  layout.css         (#app, .panel-main grid)
  tabs.css
  transcript.css     (incl. virtual list, message, reasoning, gap rows)
  message.css        (.role-user, .role-assistant, .editable, .has-user-images)
  inline-editor.css
  tool-call.css
  composer.css
  context-menu.css
  file-changes.css
  pruning-banner.css
  utilities.css
```
Wrap each file in `@layer pie.<surface>` so accidental ordering bugs cannot occur. Visual output must be byte‑identical post‑split (verify with a screenshot diff or manual A/B). Do not restyle.

---

## 3. Concrete implementation plan

Execute in phases. Each phase ends with a buildable, testable checkpoint. Do **not** combine phases — preserve the ability to bisect.

### Phase 0 — Safety net (must-do first)
1. Capture screenshots of the current UI in: empty state, mid-transcript, streaming, editing a text-only user message, text+image user message (read-only today), with attachments queued in the composer, with file-changes panel open, narrow + wide widths. Store under `extension/test/__snapshots__/chat-ui-baseline/` (or an explicitly named manual-baseline folder if no screenshot runner is added) and reference from Phase 7 diff.
2. **There are currently no DOM-mounted webview UI integration tests** — the existing 75 extension test files cover dispatch, state reducers, stream smoothing, transcript rendering via SSR, and auto-scroll math, but never mount `<App>`. `webview-render.test.ts` uses `preact-render-to-string`; it does not provide a DOM.
3. Before adding the smoke test, make `<App>` importable without calling `acquireVsCodeApi()` at module top level. Minimal shape: move app shell to `panel/app.tsx` with injectable `postMessage`/initial-state adapter, keep `panel.tsx` as the VS Code entry that calls `acquireVsCodeApi()` and mounts.
4. Add DOM test dependencies deliberately. Prefer `happy-dom` + `@testing-library/preact` for the Node test runner unless investigation shows `jsdom` is already available. Add the smallest setup helper (`extension/test/_helpers/dom.ts`) that installs/cleans `window`, `document`, `ResizeObserver` stub, and fake `requestAnimationFrame`. Note: happy-dom/jsdom do not provide real layout; keep scroll/no-shift assertions tolerant, stub measurements intentionally, and retain manual verification as a release gate.
5. Add a smoke test under `extension/test/` that mounts the app shell with a canned `ViewState` and asserts: composer renders, transcript renders N messages, clicking a text-only user message enters edit mode without posting, pressing Enter in the composer posts the correct `send` payload with the active `sessionPath`, and Escape exits edit mode.
6. Add a **render-count harness** (`extension/test/_helpers/render-counter.ts`). Implementation approach: export a `createRenderCounter(name: string)` that returns `{ RenderCount: ComponentType, getCount(id: string): number, reset(): void }`. Internally, `RenderCount` wraps the target component and increments a `Map<string, number>` on each render. In Preact, component renders are counted by placing a `useRef(0)` increment in the body of the wrapper — Preact calls the component function on each render, same as React. Access counts via the returned `getCount`/`reset` helpers. If needed, export an un-memoized `MessageItemView` for tests while keeping `MessageItem = memo(MessageItemView)` as the production export. Phase 2 + Phase 4 done criteria assert render counts for `MessageItem`/`MessageItemView`, not just parent row functions.
7. Run `npm run test -- --package extension` baseline. Record current pass count and any pre-existing skips/flakes.

### Phase 1 — Introduce the signal store (no behavior change yet)
Files: new `panel/store/{index,dispatch,session-store,selectors}.ts`, new `panel/app.tsx` if Phase 0 did not already create it. Modify `panel.tsx`.

1. Create signals enumerated in §2.2. Keep the host-facing `ViewState` field names intact; internally add per-session cache fields where current `ViewState` is active-only.
2. Build `applyHostMessage(msg)` that reproduces the existing reducer logic from `panel.tsx`'s `handleMessage`, including: snapshot vs patch, revision tracking, host instance changes, active-session changes, draft restore queue, token rate sampling, and full-snapshot overlay flush/reset.
3. On every full snapshot, copy active-scoped fields into `sessionStore(msg.state.activeSession.path)`. Before disposing removed paths, handle pending-session path replacement: if an old `__pending__:` path disappears and a new real path appears in the same tab position (or as the new committed active session), migrate the session store oldPath → newPath. Then dispose truly closed paths. On host instance change, dispose all session stores before applying the new snapshot.
4. Replace `panel.tsx`'s `useState(viewState)` with direct signal reads (`someSig.value`) in `App`/leaf components. Do not use `useSignalValue`; it is not exported by `@preact/signals`. Preserve separate committed-vs-requested active-path state so stream patches cannot be routed to a tab the user clicked before the host confirmed selection.
5. Pass the same props down initially where that lowers risk — no transcript/composer behavior changes yet. Move `editingId`, `contextMenu`, `draftRestore`, `showOutcomeDialog`, and `tokenRate` into signals.
6. `panel.tsx` target size: **<150 lines** and should contain only VS Code API acquisition, listener wiring, and mount. `panel/app.tsx` can contain the app shell during the transition, but keep it similarly focused.
7. **Migrate low-risk peripheral consumers off props in the same phase**: `run-outcome-dialog.tsx`, `pruning-banner.tsx`, `context-window/*` UI components, and `SessionTabs` can read from signals directly once the store exists. Keep pure helper modules such as `file-drop/*` stateless; their callers can pass signal-derived values. Do not force the composer or transcript off props in this phase if doing so would mix state-store work with rendering/scroll work; Phase 2/4 own those changes.
8. ✅ Checkpoint: tests still green, visual identical, host snapshot/patch recovery still passes existing sync-contract tests.

### Phase 2 — Per-message streaming signals
Files: `store/session-store.ts`, `stream-smoother.ts`, `transcript/message-item.tsx`, `transcript/virtual-list-row.tsx`.

1. Replace global `Overlay` rendering flow: `applyHostMessage` routes active-session streaming patches (`messageDelta`, `messageThinking`, `toolCall`, `clearOverlay`) into the existing `stream-smoother`, whose signal sink writes into `sessionStore(activePath).streamingPartsByMessageSig`. See §2.3.2 for the smoother contract — **do not bypass it**.
2. `MessageItem` reads its own streaming parts signal directly (subscribing only that message). Remove the `overlayParts` prop from `MessageItem`.
3. `TranscriptVirtualRow` stops looking up `overlay.partsByMessage.get(row.message.id)` and stops passing `overlayParts` down. If `busy` is still active-scoped at this point, derive per-row streaming status from `runningSessionPathsSig` + message status + the presence of that message's inner streaming signal.
4. Keep `Overlay` exported as a thin compat shim (`{ partsByMessage }` derived from the per-message signal map via `computed`) until Phase 8. It may still feed legacy scroll code through Phase 4, but it must not be passed into `MessageItem` or used for markdown rendering.
5. **Automated verification** (replaces manual devtools): use the Phase 0 render-count harness. Stream synthetic deltas into a transcript with 20 visible `MessageItem`s. Run two deterministic cases: smoothing disabled/bypassed (assert one target render per raw delta) and smoothing enabled (assert one target render per smoother commit). In both cases every other visible `MessageItem` renders ≤ 2 times across the stream (initial mount + memo settle). Fail the test otherwise.
6. Add/adjust `stream-smoother.test.ts` cases for `clearOverlay` while deltas are pending; the final state must not re-emit stale buffered text after clear.
7. ✅ Checkpoint: streaming visually identical, idle messages do not re-render during streaming.

### Phase 3 — Tab persistence
Files: new `panel/tabs/transcript-host.tsx`, modify `panel/app.tsx` / `panel.tsx`.

1. Render one transcript surface per entry in `openTabPaths`, wrapped in a hide wrapper. **Important**: `display: none` zeroes `clientHeight`/`clientWidth`, which `@tanstack/virtual-core`'s `observeElementRect` will read as 0 and can corrupt measurements. Use:
   - **Default approach**: the host container is `position: relative; flex: 1; min-height: 0;`. The active surface is `position: relative; visibility: visible; z-index: 0; pointer-events: auto;`. Inactive surfaces are `visibility: hidden; position: absolute; inset: 0; z-index: -1; pointer-events: none;` and `aria-hidden="true"`. This keeps dimensions without exposing inactive content to users or screen readers.
   - **Stretch goal**: try `content-visibility: hidden` as a performance optimization (it truly skips paint work). However, it may suppress `ResizeObserver` callbacks and stale virtualizer measurements after unhide. Test with a 1000-message transcript: if `virtualizer.getTotalSize()` is correct within 1 frame of unhiding, use it. If not, stick with `visibility: hidden`. Do not spend more than 30 minutes.
2. Move `editingId`, disclosure state, scroll position/auto-follow, measurement cache, and the active-session `StreamSmoother` reference into the per-session store so they survive hide/show. Remember: inactive sessions do **not** receive streaming patches today; their store is refreshed when they become active and the host sends a full snapshot.
3. On host-confirmed active-tab change (full snapshot with a different committed active path): **(a)** flush/cancel the previously committed active session's smoother before switching patch attribution. **(b)** Ensure the newly active `sessionStore(path)` is ready; it may show the loading state until the host snapshot for that session arrives. **(c)** After the surface becomes visible, call `virtualizer.measure()` defensively and set `aria-hidden` correctly.
4. **Cleanup**: when a session leaves `openTabPaths` during full snapshot apply (close, pending-session invalidation, host restart), first run pending-path migration (old `__pending__:` path → real path) where applicable, then dispose only truly removed stores: cancel pending timers/RAFs, disconnect observers, clear in-memory measurement cache (localStorage persists), and drop inner streaming signal references. Add explicit `migrateSessionStore(oldPath, newPath)` and `disposeSessionStore(path)` helpers and call them from `applyHostMessage` based on the `openTabPaths` diff.
5. Verify: switching between already hydrated tabs is instant (<16ms paint target), scroll position preserved, no flash of `transcript-positioning`. Open/close 20 tabs in sequence and assert active observer count returns to baseline.
6. ✅ Checkpoint: tab switch is glass smooth for hydrated tabs, first activation of an unhydrated tab shows the existing loading state until host data arrives, no leaks.

### Phase 4 — Virtualizer rewrite & scroll consolidation
Files: rewrite `transcript/virtual-list.tsx` and `transcript/use-transcript-scroll.ts`. Mark `auto-scroll.ts` / `scroll-anchor.ts` unused if superseded; delete them in Phase 8 cleanup.

0. **Decide on `scroll-anchor.ts` and `auto-scroll.ts` fate up front**. Today: `use-transcript-scroll.ts:5` imports from `../auto-scroll`. Decide which utility functions migrate into the consolidated scroll hook vs which die. Document the disposition in the Phase 4 change notes or a short file comment, then remove the files in Phase 8 if no imports remain.
1. Implement `useStableVirtualizer(sessionStore, rows, scrollRef)` rather than constructing a new virtualizer in render. The hook owns the `Virtualizer` instance and lifecycle; `SessionStore` owns measurement cache and scroll state.
2. `<TranscriptVirtualList>` becomes a thin renderer that reads rows from the session store, reads virtual items after virtualizer `onChange`, and renders row components. Use a local `renderTick`/signal/`useSyncExternalStore`-style subscription only for virtualizer range changes; avoid state changes per token for non-visible rows.
3. Replace `setOptions(...)` per-render with a layout effect that calls `setOptions` only when relevant options actually change (`rows.length`, row key/estimate version, scroll element, overscan, enabled/visibility).
4. Replace permanent `initialOffset: MAX_SAFE_INTEGER` + 3-frame snap with: **(a)** Allow `initialOffset` only for the very first mount of a not-yet-measured transcript to avoid a flash of scrollbar-at-top. **(b)** Detect "first measurement complete" from virtualizer `onChange`/measured cache readiness, then call `scrollToIndex(rows.length - 1, { align: 'end' })`, then enter follow mode. **(c)** After that, ignore `initialOffset`; tab switches use the mounted virtualizer and `autoFollow`/scroll offset already in the session store.
5. Stick-to-bottom logic: a single effect observes committed transcript/stream version and `autoFollow`. If `autoFollow`, call `scrollToIndex(rows.length - 1, { align: 'end' })`. `@tanstack/virtual-core` with `scrollToFn: elementScroll` performs instant scrolls; this is acceptable because frame-aligned instant scrolls during streaming produce smooth visual motion. Drop the old custom smooth-follow RAF loop (`advanceSmoothScrollTop`).
6. Persist measured sizes per (`hash(sessionPath)`, `rowKey`) in `localStorage` via `virtualizer.measureElement` callback; do not store raw absolute session paths as localStorage keys. Cap entries per session at e.g. 5000 and cap total cache size around 256 KB with LRU eviction. Wrap `localStorage` access in try/catch for restricted webview contexts.
7. Older/newer pagination: simplify to top/bottom sentinel rows observed by `IntersectionObserver` scoped to the transcript scroll element. Preserve explicit `sessionPath` in `loadOlderTranscript`/`loadNewerTranscript` messages. Drop the 1.5s timeout dance; trust the next snapshot, but keep a small in-flight flag to avoid duplicate requests while the host is loading.
8. Target line count: `use-transcript-scroll.ts` ≤ 120 lines (down from 466).
9. ✅ Checkpoint: scroll at 60fps with 1000 messages, no jump on initial render, no jump on streaming, pagination still preserves the user's anchor when older rows prepend.

### Phase 5 — No‑shift inline editor
Files: `transcript/message-item.tsx` (`InlineEditor`), new `transcript/inline-editor.tsx`.

1. Add `ResizeObserver` on the rendered text `.message-body` div. Store its measured height in the session store (`renderedHeightByMessageId`, exposed via a per-message signal); do not mutate the protocol `ChatMessage` object with UI-only fields.
2. On `editingId === message.id`, wrap the rendered `.message-body` in a container with `min-height: <captured>px`. Render the textarea **inside** that container, replacing the markdown div.
3. Apply CSS: `field-sizing: content`, plus matching `font: inherit`, `padding: inherit`, `line-height: inherit`, `border: 0`, `background: transparent`, `resize: none`. The textarea visually overlays where the text was.
4. Move Save/Cancel buttons to `position: absolute; bottom: 8px; right: 8px` within the message container. They float **on top** of the message, not below. If toolbar space must be reserved to avoid covering the last line, account for that in the locked `min-height`/editor padding so the top edge and scroll position remain stable; any extra growth is downward only.
5. On commit/cancel: keep `min-height` for one more frame, then release. Prevents post‑edit reflow.
5a. **Image / attachment edge cases in user messages**:
   - Preserve current behavior unless a separate host/backend change is deliberately planned: user messages with `userParts` images are not editable today (`messageHasUserImages` blocks the click), and `editMessage(sessionPath, messageId, text)` only sends text after truncation. Enabling image-message edits in this refactor would risk silently dropping images. Do **not** expand scope to image-message editing.
   - Still include image-user messages in baseline screenshots and tests to prove the refactor does not accidentally make them editable or alter their layout.
   - Composer attachments are separate host-owned pending inputs; edit mode must not become a drop target. Drops while editing continue to attach to the next composer send per §7.
6. Test by clicking a text-only user message at scroll offset N; assert `scrollRef.scrollTop` is unchanged within 4px after entering edit mode.
7. ✅ Checkpoint: editing text-only user messages does not move the page; image user messages remain read-only unless a future protocol change supports editing structured content.

### Phase 6 — Registries
Files: new `transcript/registry.ts`, refactor `virtual-list-row.tsx`, `message-item.tsx`, `tool-call-item.tsx`.

1. Define `RowRenderer`, `PartRenderer`, `ToolRenderer` interfaces.
2. Built-in row kinds register themselves in `transcript/rows/*.tsx` (one file per kind), and built-in part/tool renderers do the same under their own directories.
3. Add `transcript/register-builtins.ts` that imports every built-in renderer module for side-effect registration, and import this bootstrap once from the transcript entry before rendering. Add a test that fails if a built-in row/tool kind lacks a registered renderer.
4. `virtual-list-row.tsx` becomes a 30-line dispatch shim.
5. Each tool renderer moves to its own file under `transcript/tools/`. Drop the switch in `tool-call-item.tsx`. **Co-migrate**: `tool-call-card.tsx`, `subagent.ts`, and `subagent-score-display.ts` are existing per-tool renderers/helpers — port them to the registry in the same phase so the codebase has a single style. Do not leave a half-migrated state.
6. Add a `docs/EXTENDING_TRANSCRIPT.md` showing how to add a new row kind / tool renderer (copy-paste ready). Be honest that, without generated discovery, a new renderer needs one bootstrap import in addition to the renderer file.
7. ✅ Checkpoint: same visual output, adding a hypothetical row kind no longer requires editing central dispatch switches.

### Phase 7 — CSS split
Files: split `panel.css` per §2.7 and update `extension/scripts/build.mjs`.

1. Use `@layer pie.tokens, pie.layout, pie.tabs, pie.transcript, pie.message, pie.inline-editor, pie.tool-call, pie.composer, pie.context-menu, pie.file-changes, pie.pruning-banner, pie.utilities;` declared at the top of the entry CSS.
2. **Build reality:** today `build.mjs` copies `src/webview/panel/panel.css` as a static asset; esbuild only bundles `panel.tsx`. Before adding CSS `@import`s, update the build so the served CSS is still one file:
   - Add a CSS esbuild entry (for example `src/webview/panel/styles/index.css` → `out/webview/panel/panel.css`) with `bundle: true`, `loader: { '.css': 'css' }`, and the same watch/sync behavior as the JS build; **or** add an explicit local CSS concatenation step. Prefer esbuild unless it conflicts with sourcemaps/hot reload.
   - Remove `panel.css` from the static asset copy list once esbuild owns the output. Keep `index.html` as a copied asset.
   - Update the source watcher expectations: CSS changes should be handled by esbuild watch, while the built-file watcher still sees `out/webview/panel/panel.css` and syncs the installed extension.
3. Use **build-time `@import`** only. Runtime imports in the served CSS are rejected because they can cause FOUC and serial resource loading inside the webview. Verify by inspecting `extension/out/webview/panel/panel.css` after `npm --prefix extension run build`: it should be a single concatenated stylesheet with the top-level `@layer` declaration retained and no unresolved local `@import` rules.
4. Run screenshot diff/manual A-B against Phase 0 snapshots. Zero intentional visual changes is the bar; allow only sub-pixel antialiasing noise if the comparison tooling is imperfect.
5. ✅ Checkpoint: CSS sharded, build outputs one stylesheet, visuals unchanged.

### Phase 8 — Cleanup & docs
1. Delete dead code: `Overlay` compat shim (Phase 2), `panel/auto-scroll.ts` if unused, `transcript/scroll-anchor.ts` if unused. Keep `transcript/state.ts` if it remains the lightweight `isTranscriptHydrating` helper; delete it only if that helper has moved. (Note path: `auto-scroll.ts` lives directly under `panel/`, not under `transcript/`.)
2. Update `docs/STATE_CONTRACT.md` if the snapshot/patch contract changed (it should not have — but verify).
3. Add `docs/CHAT_UI_ARCHITECTURE.md` describing the store, the registries, and the persistent‑tab model.
4. Re‑run all baseline tests + a few new ones around edit‑no‑shift and tab persistence.
5. ✅ Final checkpoint: line count diff: net negative. Targets:
   - `panel.tsx` < 150 (down from 580) and any new `panel/app.tsx` shell < 250; if it grows beyond that, split hosts by surface instead of recreating a god component.
   - `ui.tsx` < 100 (just re‑exports + ComposerHost layout primitive; the composer subdir already exists and is the home of composer logic — **do not re‑split what is already split**)
   - `use-transcript-scroll.ts` < 120 (down from 466)
   - `tool-call-item.tsx` < 50 (registry dispatch only; tool bodies migrated per Phase 6.4)
   - No file > 500 lines; every post-split CSS shard is also < 500 lines.

---

## 4. Libraries considered (and rejected)

| Candidate | Verdict | Reason |
|---|---|---|
| **Zustand** | Reject | Adds a dep for what `@preact/signals` (already installed) does natively. |
| **Jotai** | Reject | React‑oriented; signals are the Preact‑native equivalent. |
| **TanStack Query** | N/A | We are not fetching; host pushes via `postMessage`. |
| **TanStack Virtual (React adapter)** | Reject | We already use `@tanstack/virtual-core` directly. Adapter adds a useless hook layer. |
| **react‑virtuoso** | Reject | Excellent for chat‑style stick‑to‑bottom, but switching costs a rewrite and pulls in React. Stick with `virtual-core` and write the ~60 lines of stick‑to‑bottom ourselves. |
| **Lexical / TipTap / ProseMirror** for the composer | Reject | Out of scope (textarea is fine). Mention only to confirm we are not silently expanding scope. |
| **CSS modules / Tailwind** | Reject | The brief forbids restyling. CSS layers + file split is enough. |

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Persistent tabs leak memory if no explicit cleanup message arrives | There is no webview `session.cleanup` message today. On every full snapshot, migrate pending-path replacements first, then dispose stores whose paths truly left `openTabPaths`; dispose all stores on host instance changes. Manual/automated test by churning 20 sessions. |
| `field-sizing: content` unsupported on older `engines.vscode` floors | Extension floor is `^1.80.0` (below VS Code 1.92 / Chromium 124). JS fallback MUST ship. Primary path is CSS-native via `@supports (field-sizing: content)`; older instances get the JS `scrollHeight` fallback via feature detection. |
| Signal re‑renders firing during patch storms could batch poorly | `@preact/signals` batches via `batch(() => ...)`. Wrap `applyHostMessage` body in `batch`. |
| Screenshot diffs in Phase 7 produce noise (font hinting) | Compare at integer DPR with the same VS Code theme; allow ≤1 px AA tolerance, fail otherwise. |
| `localStorage` size measurement cache grows unbounded or leaks paths | Hash session paths in keys, cap at ~256 KB total, LRU evict, and skip persistence when storage access throws. |
| Mis-attributing stream patches after tab switch | `PatchOp` has no `sessionPath`; only host-active sessions receive patches. Attribute patches to the last committed snapshot active path, not an optimistic clicked tab. Keep requested-vs-committed active path separate, flush/cancel the previous committed smoother only when the host snapshot changes active path, and seed the newly active session from that snapshot. |
| Pending session path replacement drops UI state | Host can replace `__pending__:*` tab paths with real session paths. Detect same-index pending→real replacements during snapshot apply and call `migrateSessionStore(oldPath, newPath)` before disposal. |
| CSS split accidentally becomes runtime `@import` | Current build copies CSS. Phase 7 must add CSS bundling/concatenation and verify `out/webview/panel/panel.css` contains no unresolved local imports. |
| Clear overlay races with smoothed pending deltas | Add smoother tests and implementation that flushes/cancels pending deltas for affected message ids before clearing streaming signals. |

## 6. Done criteria



A change is accepted into `main` only when **all** are true:
1. `npm run test` passes for `extension` and all dependent packages. New tests for: signal store dispatch, tab persistence (scroll preserved after switch+back), inline edit no‑shift (scrollTop delta ≤ 4 px).
2. `npm run typecheck` clean, `npm --prefix extension run build` clean.
3. Manual smoke: stream a 200‑message session, switch tabs back and forth, edit three user messages mid‑transcript, attach a file and send. No visible hitch.
4. Render-count harness (Phase 0.6) asserts two explicit scenarios: (a) with smoothing disabled/bypassed for deterministic per-delta assertions, each raw delta rerenders only the target `MessageItem`; (b) with smoothing enabled, each smoother commit rerenders only the target `MessageItem`. In both scenarios, every other visible `MessageItem` renders ≤ 2 times across the stream. This is an automated test, not a manual check.
5. Line counts as listed in Phase 8.
6. Screenshot parity at Phase 7 boundary.

## 7. Cross‑cutting concerns (do not forget)
- **Focus management**: when entering edit mode, place caret at end of textarea (existing behavior — preserve). On Save/Cancel, return focus to the message container so Tab order is sane. On tab switch, focus the composer textarea (preserve existing `focusTrigger` effect).
- **Accessibility**: hidden transcripts (Phase 3) MUST get `aria-hidden="true"` to keep screen readers from announcing them. Streaming messages should retain the existing `aria-live="polite"` on the body. The new inline editor needs `aria-label="Edit message"` (already present).
- **File drop during edit**: today the composer accepts drops globally. Decide explicitly: drops on a message in edit mode either (a) attach to the next composer send, or (b) are blocked with a tooltip. Pick (a) for least surprise; add a test.
- **Context menu**: today mounted at panel root with fixed positioning computed once. Add resize/scroll dismissal — close on any window resize, escape, or outside click (escape + outside‑click already exist).
- **`--composer-height` CSS var**: today set imperatively via `ResizeObserver` in `ui.tsx`. After the rework, encode this in the layout primitive (a `<ComposerHost>` wrapper component) so the coupling is named and documented rather than buried.
- **Draft restoration**: `draftRestoreSig` per session must preserve today's behavior — the existing `pendingDraftRestore` map in `panel.tsx` queues `sendRejected` text until that session becomes active. The store hosts the same queue. Do **not** introduce a parallel `localStorage` draft store; pending composer inputs are host-owned session state per `STATE_CONTRACT.md` Session Cleanup, and local draft storage would create a two-writer race.
- **Tab order**: `openTabPaths` ordering today is host‑authoritative. The plan does not introduce client‑side reordering. If reordering UX is added later, it lands as a host action (`postMessage` to mutate order on the host, host responds with new snapshot). Out of scope for this refactor — do not implement tab reordering opportunistically.
- **STATE_CONTRACT.md compliance**: the signal store is a local mirror of the authoritative host state. All mutating actions still go via `postMessage` with explicit `sessionPath` (never falls back to active). Optimistic writes (e.g., setting `editingId` locally before host confirms `editMessage`) remain reversible: if the host snapshot returns without the edit applied, the local `editingId` clears on snapshot apply. Reviewer should grep the new store for any silent `activeSessionPath` fallback in mutating dispatches.

## 8. What an implementing agent should NOT do
- Do not change visual styling (colors, spacing, typography, borders, radii). Layer/file moves only, except for the intentional inline-editor structural fix that relocates Save/Cancel controls without changing the overall visual language.
- Do not change the host↔webview protocol in this refactor. In particular, do not add `sessionPath` to `PatchOp` or make snapshots carry all open-tab transcripts unless a separate protocol migration plan and STATE_CONTRACT update is approved. The store wraps the current active-only contract; it does not replace it.
- Do not introduce React or `@tanstack/react-virtual`. Stay on Preact + `@preact/signals` + `@tanstack/virtual-core`.
- Do not collapse phases. Each phase is independently shippable and bisectable.
- Do not delete `Overlay`, `auto-scroll.ts`, or `transcript/scroll-anchor.ts` before Phase 8 cleanup — leave shims/comments in place until replacement code is proven.
