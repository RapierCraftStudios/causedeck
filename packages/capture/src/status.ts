// The capture status machine (#43): `received -> scanning -> queued -> processing ->
// (ready|needs_you|failed)`. `duplicate`, `quarantined` and `discarded` are terminal, as is
// `applied`. A capture that skips scanning (manual, Stage A no-op) goes `received -> queued`.
// Every transition appends `{from, to, at, reason?}` to `source_meta.history`.
import type { CaptureHistoryEntry, CaptureStatus } from './types.ts';

export const CAPTURE_TRANSITIONS: Readonly<Record<CaptureStatus, readonly CaptureStatus[]>> =
  Object.freeze({
    received: ['scanning', 'queued', 'failed', 'duplicate', 'quarantined', 'discarded'],
    scanning: ['queued', 'quarantined', 'failed', 'discarded'],
    queued: ['processing', 'failed', 'discarded'],
    processing: ['ready', 'needs_you', 'failed', 'discarded'],
    needs_you: ['ready', 'applied', 'failed', 'discarded'],
    ready: ['applied', 'discarded'],
    applied: [],
    failed: ['discarded'],
    duplicate: [],
    quarantined: [],
    discarded: [],
  });

/** Terminal statuses: nothing leaves them. */
export const TERMINAL_STATUSES: readonly CaptureStatus[] = [
  'applied',
  'duplicate',
  'quarantined',
  'discarded',
];

export class IllegalTransitionError extends Error {
  override name = 'IllegalTransitionError';

  constructor(
    readonly from: CaptureStatus,
    readonly to: CaptureStatus,
  ) {
    super(`a capture cannot move from ${from} to ${to}`);
  }
}

export function canTransition(from: CaptureStatus, to: CaptureStatus): boolean {
  return CAPTURE_TRANSITIONS[from].includes(to);
}

export interface TransitionState {
  status: CaptureStatus;
  sourceMeta: Record<string, unknown>;
}

/** The history already recorded in `source_meta`; anything malformed reads as empty. */
export function historyOf(sourceMeta: Record<string, unknown>): CaptureHistoryEntry[] {
  const history = sourceMeta['history'];
  return Array.isArray(history) ? (history as CaptureHistoryEntry[]) : [];
}

/**
 * The state after moving to `to` at `at`, with the transition appended to `source_meta.history`.
 * Throws `IllegalTransitionError` for a move the machine does not allow; the input is not mutated.
 */
export function transition(
  state: TransitionState,
  to: CaptureStatus,
  at: Date,
  reason?: string,
): TransitionState {
  if (!canTransition(state.status, to)) throw new IllegalTransitionError(state.status, to);
  const entry: CaptureHistoryEntry = {
    from: state.status,
    to,
    at: at.toISOString(),
    ...(reason === undefined ? {} : { reason }),
  };
  return {
    status: to,
    sourceMeta: { ...state.sourceMeta, history: [...historyOf(state.sourceMeta), entry] },
  };
}
