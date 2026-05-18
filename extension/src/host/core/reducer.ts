/**
 * Top-level reducer: `(state, event) → {state, effects}`.
 *
 * The reducer is **pure**: no I/O, no globals, no mutation of input.
 * Effects are queued descriptively; the `EffectRunner` executes them and
 * dispatches result events back.
 *
 * Phase 3 adds the first real handler: `Interrupt`. Legacy Redux slices
 * continue to own all other state until later phases migrate them.
 *
 * **State-shape rule (binding):** keyed collections in `ArchState` MUST use
 * `Record<string, T>` — never `Map`/`Set`. RTK + Immer reject mutating those
 * built-ins without an explicit `enableMapSet()` opt-in; treat that opt-in as
 * a deliberate decision, not a default.
 */

import type { Event } from './events';
import type { Effect } from './effects';

/** Per-session state tracked by the new architecture. */
export interface SessionArchState {
  interruptInFlight: boolean;
}

/**
 * Top-level arch state. Slots are intentionally `Record<string, ...>` rather
 * than `Map<...>` to remain compatible with RTK/Immer middleware.
 */
export interface ArchState {
  /** Optimistic pending operations keyed by `corrId` (Phase 4). */
  pending: Record<string, never>;
  /** Per-session arch state keyed by session path. */
  sessions: Record<string, SessionArchState>;
}

export const initialArchState: ArchState = {
  pending: {},
  sessions: {},
};

export interface ReducerResult {
  state: ArchState;
  effects: Effect[];
}

function getSession(state: ArchState, sessionPath: string): SessionArchState {
  return state.sessions[sessionPath] ?? { interruptInFlight: false };
}

/**
 * Reducer: routes events to per-kind handlers.
 * Currently handles: Interrupt command, InterruptResult event.
 * All other events pass through unchanged (no-op).
 */
export function reducer(state: ArchState, event: Event): ReducerResult {
  switch (event.kind) {
    case 'Command': {
      const { cmd } = event;
      switch (cmd.kind) {
        case 'Interrupt': {
          const session = getSession(state, cmd.sessionPath);
          return {
            state: {
              ...state,
              sessions: {
                ...state.sessions,
                [cmd.sessionPath]: { ...session, interruptInFlight: true },
              },
            },
            effects: [{ kind: 'InterruptRpc', corrId: cmd.corrId, sessionPath: cmd.sessionPath }],
          };
        }
        default:
          return { state, effects: [] };
      }
    }

    case 'InterruptResult': {
      const session = getSession(state, event.sessionPath);
      const effects: Effect[] = [];
      if (!event.ok) {
        effects.push({
          kind: 'Log',
          corrId: event.corrId,
          level: 'error',
          message: `Interrupt failed for session ${event.sessionPath}`,
          data: { error: event.error },
        });
      }
      return {
        state: {
          ...state,
          sessions: {
            ...state.sessions,
            [event.sessionPath]: { ...session, interruptInFlight: false },
          },
        },
        effects,
      };
    }

    default:
      return { state, effects: [] };
  }
}
