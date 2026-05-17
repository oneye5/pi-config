# Chat UI Architecture

Overview of the webview chat surface architecture after the Phase 0–8 rework.

## Entry point

`panel.tsx` (~20 lines) acquires `vscodeApi`, creates the `AppAdapter`, and mounts `<App>`.  
`app.tsx` is the app shell: session tabs, empty states, and the transcript host.

## Signal store (`store/`)

Global and per-session state lives in `@preact/signals`.

| Module | Purpose |
|---|---|
| `signals.ts` | Global signals: sessions list, active path, open tabs, prefs, host meta |
| `session-store.ts` | Per-session stores: transcript, streaming map, editing, overlays |
| `dispatch.ts` | `applyHostMessage(msg)` routes host snapshots/patches to signals via `batch()` |
| `actions.ts` | Wraps `postMessage` for webview → host communication |

### Per-message streaming

`StreamSmoother` accepts a `StreamSmootherPatchSink` that commits each streaming delta into a per-message `Signal<ChatMessagePart[]>` in `SessionStore.streamingMapSig`. Only the affected `MessageItem` re-renders.

## Persistent tabs (`transcript/transcript-host.tsx`)

`TranscriptHost` renders one `TranscriptSurface` per open tab. The active surface is visible; inactive surfaces are hidden via `visibility:hidden; position:absolute` to preserve virtualizer measurements and scroll position across tab switches.

## Virtualizer & scroll (`transcript/virtual-list.tsx`, `use-transcript-scroll.ts`)

- `@tanstack/virtual-core` Virtualizer instance created once per list, options updated via layout effect.
- `useTranscriptScroll` handles auto-follow (instant scroll on content change), manual scroll detection, and older/newer pagination.
- Smooth-follow RAF loop removed; instant scrolls during streaming produce smooth motion at frame rate.

## Registries (`transcript/registry.ts`)

Row and tool renderers register via side-effect imports in `register-builtins.ts`.

```ts
registerRowRenderer('message', renderMessage);
registerToolRenderer('subagent', SubagentToolRenderer);
```

`virtual-list-row.tsx` is a ~10 line dispatch shim that looks up the renderer by `row.kind`.

### Adding a new row kind

1. Create `transcript/rows/my-row.tsx`
2. Call `registerRowRenderer('myKind', myRenderer)`
3. Import the file in `register-builtins.ts`

### Adding a new tool renderer

1. Create `transcript/tools/my-tool.tsx`
2. Call `registerToolRenderer('myTool', myRenderer)`
3. Import the file in `register-builtins.ts`

## Inline editor (`transcript/inline-editor.tsx`)

No-shift editing: `ResizeObserver` captures `.message-body` height. On edit, the container locks `min-height` to the captured value. Textarea uses `field-sizing: content`. Save/Cancel buttons are `position: absolute; bottom: 8px; right: 8px`.

## CSS (`styles/`)

CSS is split into sharded files under `styles/`, bundled by esbuild into a single `panel.css` output. Layer order declared in `styles/index.css`:

```
@layer pie.tokens, pie.layout, pie.tabs, pie.transcript, pie.inline-editor,
       pie.tool-call, pie.composer, pie.context-menu, pie.file-changes, pie.pruning-banner;
```

Each shard is `@import`-ed into its layer. No runtime `@import` in the served CSS.
