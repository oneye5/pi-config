import type { PatchOp } from '../../shared/protocol';
import { emptyOverlay, applyPatch } from './overlay';
import type { Overlay } from './overlay';

/**
 * Narrow sink interface for per-message signal routing.
 * Called with the committed PatchOp after smoothing. The sink is responsible
 * for writing into the appropriate per-message signal.
 */
export interface StreamSmootherPatchSink {
  commit(op: PatchOp): void;
}

/** Configuration for stream smoothing. */
export interface StreamSmootherConfig {
  /**
   * Approximate cadence of visible text updates, in milliseconds.
   * Lower values = faster streaming. Default: 50ms.
   */
  charDisplayMs: number;
  /**
   * Minimum characters before triggering smoothing.
   * Small deltas bypass smoothing for responsiveness. Default: 4
   */
  minCharsForSmoothing: number;
  /**
   * Maximum characters to emit in a single batch.
   * Keeps the streaming smooth even when large chunks arrive. Default: 20
   */
  maxEmitBatch: number;
  /**
   * Minimum delay between emit batches, in milliseconds.
   * Acts as a hard floor for the update cadence. Default: 20ms.
   */
  minEmitIntervalMs: number;
}

export const DEFAULT_STREAM_SMOOTHER_CONFIG: StreamSmootherConfig = {
  charDisplayMs: 50,
  minCharsForSmoothing: 4,
  maxEmitBatch: 20,
  minEmitIntervalMs: 20,
};

interface PendingDelta {
  messageId: string;
  delta: string;
}

interface StreamSmootherState {
  pendingDeltas: PendingDelta[];
  emitTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * StreamSmoother smooths incoming message deltas by gradually emitting characters
 * over time, creating the illusion of character-by-character streaming instead of
 * chunky bursts. This is particularly helpful for providers like Ollama that tend
 * to send text in larger, less frequent chunks.
 *
 * Features:
 * - Buffers incoming deltas and releases them gradually
 * - Bypasses smoothing for small deltas (avoids unnecessary overhead)
 * - Configurable via StreamSmootherConfig
 */
export class StreamSmoother {
  private readonly config: StreamSmootherConfig;
  private readonly state: StreamSmootherState;
  private readonly onFlush: (overlay: Overlay) => void;
  private readonly patchSink: StreamSmootherPatchSink | null;
  private overlay: Overlay;

  constructor(
    config: Partial<StreamSmootherConfig>,
    onFlush: (overlay: Overlay) => void,
    patchSink?: StreamSmootherPatchSink,
  ) {
    this.config = { ...DEFAULT_STREAM_SMOOTHER_CONFIG, ...config };
    this.state = {
      pendingDeltas: [],
      emitTimer: null,
    };
    this.overlay = emptyOverlay();
    this.onFlush = onFlush;
    this.patchSink = patchSink ?? null;
  }

  /**
   * Process an incoming patch operation. Buffers deltas for smooth streaming.
   */
  processPatch(op: PatchOp): Overlay {
    if (op.kind !== 'messageDelta') {
      // Non-delta patches are applied immediately
      this.overlay = applyPatch(this.overlay, op);
      this.onFlush(this.overlay);
      this.patchSink?.commit(op);
      return this.overlay;
    }

    const { delta } = op;
    const deltaLength = delta.length;

    // Small delta: apply immediately without smoothing
    if (deltaLength < this.config.minCharsForSmoothing) {
      this.overlay = applyPatch(this.overlay, op);
      this.onFlush(this.overlay);
      this.patchSink?.commit(op);
      return this.overlay;
    }

    // Buffer for smooth streaming.
    // Important: do not reset an already-scheduled emit timer here. If deltas
    // arrive faster than the timer interval, resetting the timer on every patch
    // starves emission and makes streaming appear frozen until a later flush.
    this.state.pendingDeltas.push({
      messageId: op.messageId,
      delta,
    });
    this.scheduleEmit();

    return this.overlay;
  }

  /**
   * Emit a batch of buffered deltas with smoothing.
   */
  private emitSmoothedBatch(): void {
    if (this.state.pendingDeltas.length === 0) {
      return;
    }

    // Calculate how many characters we can emit in this batch
    let charsRemaining = this.config.maxEmitBatch;
    const emittedDeltas: PendingDelta[] = [];

    // Process deltas in order, splitting as needed
    while (charsRemaining > 0 && this.state.pendingDeltas.length > 0) {
      const pending = this.state.pendingDeltas[0];

      if (pending.delta.length <= charsRemaining) {
        // Can emit the full delta
        emittedDeltas.push(this.state.pendingDeltas.shift()!);
        charsRemaining -= pending.delta.length;
      } else {
        // Split the delta: emit portion, keep remainder
        const emitPortion = pending.delta.slice(0, charsRemaining);
        const keepPortion = pending.delta.slice(charsRemaining);
        this.state.pendingDeltas[0] = {
          messageId: pending.messageId,
          delta: keepPortion,
        };
        emittedDeltas.push({
          messageId: pending.messageId,
          delta: emitPortion,
        });
        charsRemaining = 0;
      }
    }

    // Apply all emitted deltas
    for (const emitted of emittedDeltas) {
      const op: PatchOp = {
        kind: 'messageDelta',
        messageId: emitted.messageId,
        delta: emitted.delta,
      };
      this.overlay = applyPatch(this.overlay, op);
      this.patchSink?.commit(op);
    }
    this.onFlush(this.overlay);

    // If there's more to emit, keep draining at the configured cadence.
    this.scheduleEmit();
  }

  private scheduleEmit(): void {
    if (this.state.emitTimer !== null || this.state.pendingDeltas.length === 0) {
      return;
    }

    this.state.emitTimer = setTimeout(() => {
      this.state.emitTimer = null;
      this.emitSmoothedBatch();
    }, this.getEmitDelayMs());
  }

  private getEmitDelayMs(): number {
    return Math.max(
      this.config.minEmitIntervalMs,
      Math.round(this.config.charDisplayMs),
    );
  }

  /**
   * Flush all pending deltas immediately, bypassing smoothing.
   */
  flushAll(): Overlay {
    if (this.state.emitTimer !== null) {
      clearTimeout(this.state.emitTimer);
      this.state.emitTimer = null;
    }

    if (this.state.pendingDeltas.length === 0) {
      return this.overlay;
    }

    for (const pending of this.state.pendingDeltas) {
      const op: PatchOp = {
        kind: 'messageDelta',
        messageId: pending.messageId,
        delta: pending.delta,
      };
      this.overlay = applyPatch(this.overlay, op);
      this.patchSink?.commit(op);
    }
    this.state.pendingDeltas = [];
    this.onFlush(this.overlay);
    return this.overlay;
  }

  /**
   * Reset the smoother state.
   */
  reset(): void {
    if (this.state.emitTimer !== null) {
      clearTimeout(this.state.emitTimer);
      this.state.emitTimer = null;
    }
    this.state.pendingDeltas = [];
    this.overlay = emptyOverlay();
  }

  /**
   * Get current pending character count.
   */
  getPendingCharCount(): number {
    return this.state.pendingDeltas.reduce((sum, p) => sum + p.delta.length, 0);
  }
}