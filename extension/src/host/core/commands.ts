/**
 * Phase 2 type spine — `Command` discriminated union.
 *
 * Commands are intents originating from the webview (user actions) or other
 * inputs that the host must process. Each command carries a `corrId` for
 * optimistic-update reconciliation (Phase 4) and, where applicable, an
 * explicit `sessionPath` (the Phase 1 session-routing invariant — no implicit
 * "viewed session" fallback). This file is the future replacement for the
 * action-shaped variants of `WebviewToHostMessage`; today, no code consumes
 * these types yet.
 */

import type { ComposerInputDraft } from '../../shared/protocol';

/** Common fields on every command. */
export interface CommandBase {
  corrId: string;
}

/** Send a new user message. */
export interface SendCommand extends CommandBase {
  kind: 'Send';
  sessionPath: string;
  text: string;
}

/** Edit an existing message (truncates the transcript after it). */
export interface EditCommand extends CommandBase {
  kind: 'Edit';
  sessionPath: string;
  messageId: string;
  text: string;
}

/** Interrupt the in-flight assistant turn for a session. */
export interface InterruptCommand extends CommandBase {
  kind: 'Interrupt';
  sessionPath: string;
}

/** Truncate the transcript after a given message. */
export interface TruncateAfterCommand extends CommandBase {
  kind: 'TruncateAfter';
  sessionPath: string;
  messageId: string;
}

/** Open an existing session (becomes active). */
export interface OpenSessionCommand extends CommandBase {
  kind: 'OpenSession';
  sessionPath: string;
  /** Token issued by the lifecycle queue to detect stale selections. */
  selectionToken: string;
}

/** Create a brand-new session and open it. */
export interface CreateSessionCommand extends CommandBase {
  kind: 'CreateSession';
  /** Token issued by the lifecycle queue to detect stale selections. */
  selectionToken: string;
}

/** Persist the tab order / active tab to globalState. */
export interface PersistTabsCommand extends CommandBase {
  kind: 'PersistTabs';
  openTabPaths: string[];
  activeSessionPath: string | null;
}

/** Add a composer input draft (file attachment) to a session. */
export interface AddComposerInputCommand extends CommandBase {
  kind: 'AddComposerInput';
  sessionPath: string;
  input: ComposerInputDraft;
}

/** Remove a composer input draft from a session. */
export interface RemoveComposerInputCommand extends CommandBase {
  kind: 'RemoveComposerInput';
  sessionPath: string;
  inputId: string;
}

export type Command =
  | SendCommand
  | EditCommand
  | InterruptCommand
  | TruncateAfterCommand
  | OpenSessionCommand
  | CreateSessionCommand
  | PersistTabsCommand
  | AddComposerInputCommand
  | RemoveComposerInputCommand;
