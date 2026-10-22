import { describe, expect, it } from 'vitest';

import {
  CAPTURE_STATUSES,
  CAPTURE_TRANSITIONS,
  canTransition,
  historyOf,
  IllegalTransitionError,
  TERMINAL_STATUSES,
  transition,
  type CaptureStatus,
  type TransitionState,
} from '../index.ts';

const AT = new Date('2026-10-19T10:00:00Z');

describe('status machine', () => {
  it('walks received -> scanning -> queued -> processing -> ready, recording each step', () => {
    let state: TransitionState = { status: 'received', sourceMeta: { channel: 'upload' } };
    for (const next of ['scanning', 'queued', 'processing', 'ready'] as const) {
      state = transition(state, next, AT);
    }
    expect(state.status).toBe('ready');
    expect(state.sourceMeta['channel']).toBe('upload');
    expect(historyOf(state.sourceMeta)).toEqual([
      { from: 'received', to: 'scanning', at: AT.toISOString() },
      { from: 'scanning', to: 'queued', at: AT.toISOString() },
      { from: 'queued', to: 'processing', at: AT.toISOString() },
      { from: 'processing', to: 'ready', at: AT.toISOString() },
    ]);
  });

  it('allows processing to end needs_you or failed, and a skipped scan to go received -> queued', () => {
    expect(canTransition('processing', 'needs_you')).toBe(true);
    expect(canTransition('processing', 'failed')).toBe(true);
    expect(canTransition('received', 'queued')).toBe(true);
  });

  it('records the reason of a transition', () => {
    const next = transition({ status: 'received', sourceMeta: {} }, 'failed', AT, 'too_large');
    expect(historyOf(next.sourceMeta)[0]).toMatchObject({ to: 'failed', reason: 'too_large' });
  });

  it('keeps duplicate, quarantined, discarded and applied terminal', () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual([
      'applied',
      'discarded',
      'duplicate',
      'quarantined',
    ]);
    for (const from of TERMINAL_STATUSES) {
      for (const to of CAPTURE_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
        expect(() => transition({ status: from, sourceMeta: {} }, to, AT)).toThrow(
          IllegalTransitionError,
        );
      }
    }
  });

  it('throws on moves the machine does not allow and leaves the input alone', () => {
    const state = { status: 'received' as CaptureStatus, sourceMeta: {} };
    for (const to of ['processing', 'ready', 'needs_you', 'applied'] as const) {
      expect(() => transition(state, to, AT), to).toThrow(IllegalTransitionError);
    }
    expect(() => transition({ status: 'queued', sourceMeta: {} }, 'scanning', AT)).toThrow(
      IllegalTransitionError,
    );
    expect(state).toEqual({ status: 'received', sourceMeta: {} });
  });

  it('names every status in the table', () => {
    expect(Object.keys(CAPTURE_TRANSITIONS).sort()).toEqual([...CAPTURE_STATUSES].sort());
  });

  it('reads malformed history as empty', () => {
    expect(historyOf({ history: 'x' })).toEqual([]);
    expect(historyOf({})).toEqual([]);
  });
});
