# pie State Contract

## Session Selection

- The host store owns selection through `activeSessionPath`.
- `activeSession` in the webview snapshot is derived from `activeSessionPath` plus the current session summaries.
- `session.create` and `session.open` carry a `selectionToken`.
- `session.opened` may only activate a tab when its `selectionToken` still owns selection.
- Stale `session.opened` payloads may refresh cached data, but they must not steal focus.

## Session Routing

- Mutating backend requests require an explicit `sessionPath`.
- `message.send`, `message.interrupt`, and `session.truncateAfter` never fall back to the viewed or active session implicitly.
- Session-scoped backend events must include `sessionPath`.
- Missing `sessionPath` is treated as a protocol defect.

## Session Cleanup

- Closing or invalidating a session clears transcript state, alias state, current-turn state, busy dedup state, pending composer inputs, and queued per-session operations.
- Pending composer inputs are session-scoped host state: close/invalidate clears them for that session; extension restart/shutdown clears all remaining pending inputs.
- Pending-session placeholders are cleaned up one session at a time; overlapping creates must not share teardown.
- Pending session identifiers must be collision-safe under rapid repeated creation.

## Snapshot And Patch Recovery

- Full snapshots are the authoritative base.
- A full snapshot contains the currently loaded transcript window (`transcript`) plus explicit window metadata (`transcriptWindow`), not necessarily the entire historical transcript.
- Patch envelopes are **session-addressed**: every `patch` message carries a `sessionPath` and the webview routes the patch to the matching per-session overlay/revision counter.
- Patch revisions are **per-session** on the host: a patch addressed to session A advances only A's revision counter; sessions B, C are unaffected.
- State-envelope revisions are global and advance on each full snapshot; they continue to detect host-instance counter resets in combination with `hostInstanceId`.
- Every envelope (state and patch) carries `protocolVersion` matching `WEBVIEW_PROTOCOL_VERSION`.
- Patches are applied even while a session is not the active tab so background streams do not pollute the active view; non-active patches update per-session overlays that the webview holds but does not render.
- If a patch cannot be delivered (view hidden or webview not ready), the host marks **that session** dirty (not a global flag) and the next flush emits a full snapshot.
- When visibility returns, the next host-to-webview sync is a full snapshot. A full snapshot resets all per-session revision counters on both host and webview.
- The webview clears overlay/transient UI when the host instance changes or the active session changes.
- A busy `session.opened` refresh may update tab/session metadata, but it must not discard in-memory optimistic or streaming transcript state that is newer than the backend snapshot.

## Execution Ordering

- Lifecycle requests (`create`, `open`) are serialized through a host lifecycle queue.
- Session mutations (`send`, `edit`, `truncateAfter`, `interrupt`) are serialized per session path.
- Optimistic UI writes must be reversible when the authoritative operation fails.