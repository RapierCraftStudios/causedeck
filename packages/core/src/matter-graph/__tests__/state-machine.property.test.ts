// The proceeding transition table (#363, ADR 0014; AC of #33): exactly eight ordered pairs are
// allowed, the reopen needs a non-blank reason, and every other of the 36 ordered pairs throws
// `InvalidTransitionError`. fast-check draws the pairs and the reasons; an exhaustive loop checks
// all 36 pairs deterministically as well.
import { PROCEEDING_STATES, type ProceedingState } from '@causedeck/db/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { assertTransition, InvalidTransitionError, PROCEEDING_TRANSITIONS } from '../index.ts';

const ALLOWED = new Set([
  'filed->sr_fr',
  'sr_fr->defects',
  'sr_fr->numbered',
  'defects->re_presented',
  're_presented->defects',
  're_presented->numbered',
  'numbered->disposed',
  'disposed->numbered',
]);

const state = fc.constantFrom(...PROCEEDING_STATES);
const blank = fc.constantFrom(undefined, null, '', ' ', '\t', '  \n ');
const reasonText = fc.string({ minLength: 1 }).filter((value) => value.trim() !== '');

/** The error `assertTransition` throws, or undefined when it allows the pair. */
function outcome(from: ProceedingState, to: ProceedingState, reason?: string | null) {
  try {
    assertTransition(from, to, reason);
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('proceeding transition table', () => {
  it('allows exactly the eight listed pairs of all 36 (a reopen with a reason)', () => {
    let pairs = 0;
    for (const from of PROCEEDING_STATES) {
      for (const to of PROCEEDING_STATES) {
        pairs++;
        const error = outcome(from, to, 'Reason on record');
        if (ALLOWED.has(`${from}->${to}`)) {
          expect(error, `${from}->${to}`).toBeUndefined();
        } else {
          expect(error, `${from}->${to}`).toBeInstanceOf(InvalidTransitionError);
          expect(error).toMatchObject({ code: 'CONFLICT', from, to });
        }
      }
    }
    expect(pairs).toBe(36);
    const table = Object.entries(PROCEEDING_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => `${from}->${to}`),
    );
    expect(new Set(table)).toEqual(ALLOWED);
  });

  it('property: any ordered pair is allowed iff the table lists it', () => {
    fc.assert(
      fc.property(state, state, fc.option(reasonText, { nil: undefined }), (from, to, reason) => {
        const error = outcome(from, to, reason);
        const listed = ALLOWED.has(`${from}->${to}`);
        const needsReason = from === 'disposed' && to === 'numbered';
        if (listed && (!needsReason || reason !== undefined)) return error === undefined;
        return error instanceof InvalidTransitionError && error.code === 'CONFLICT';
      }),
      { numRuns: 500 },
    );
  });

  it('property: a reopen without a non-blank reason is an InvalidTransitionError', () => {
    fc.assert(
      fc.property(blank, (reason) => {
        const error = outcome('disposed', 'numbered', reason);
        return error instanceof InvalidTransitionError && error.from === 'disposed';
      }),
    );
    fc.assert(
      fc.property(reasonText, (reason) => outcome('disposed', 'numbered', reason) === undefined),
    );
  });

  it('property: only the reopen looks at the reason', () => {
    fc.assert(
      fc.property(state, state, blank, (from, to, reason) => {
        if (from === 'disposed') return true;
        const listed = ALLOWED.has(`${from}->${to}`);
        return (outcome(from, to, reason) === undefined) === listed;
      }),
    );
  });
});
