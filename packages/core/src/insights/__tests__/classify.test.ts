// The definitions of Prepared & Kept and obligation health (#85) as pure rules on fixtures: no
// obligations, rescheduled, delegated (another owner), overdue, pending, closed as not applicable.
import { describe, expect, it } from 'vitest';

import { classifyAppearance, classifyObligation, rate, type ObligationFacts } from '../classify.ts';

const TODAY = '2026-11-10';
const base: ObligationFacts = {
  status: 'open',
  ownerMemberId: 'm1',
  dueDate: '2026-11-20',
  reschedules: 0,
};

describe('classifyObligation', () => {
  it.each([
    ['done and owned', { status: 'done' as const }, 'kept'],
    ['open and not yet due', {}, 'pending'],
    ['due today is not yet a miss', { dueDate: TODAY }, 'pending'],
    ['overdue and never rescheduled', { dueDate: '2026-11-01' }, 'missed'],
    [
      'overdue but deliberately rescheduled',
      { dueDate: '2026-11-01', reschedules: 1 },
      'rescheduled',
    ],
    ['not owned', { ownerMemberId: null }, 'uncaptured'],
    ['not owned even when done', { ownerMemberId: null, status: 'done' as const }, 'uncaptured'],
    ['open without a due date', { dueDate: null }, 'uncaptured'],
    ['closed as not applicable', { status: 'not_applicable' as const }, 'resolved'],
    ['superseded', { status: 'superseded' as const, ownerMemberId: null }, 'resolved'],
  ])('%s', (_name, patch, expected) => {
    expect(classifyObligation({ ...base, ...patch }, TODAY)).toBe(expected);
  });
});

describe('classifyAppearance', () => {
  it('needs the brief: no obligations still depends on it', () => {
    expect(classifyAppearance(true, [])).toBe('kept');
    expect(classifyAppearance(false, [])).toBe('not_kept');
  });
  it('is kept when every obligation is kept, rescheduled or resolved', () => {
    expect(classifyAppearance(true, ['kept', 'rescheduled', 'resolved'])).toBe('kept');
  });
  it('fails on a miss or an uncaptured obligation, even beside a pending one', () => {
    expect(classifyAppearance(true, ['kept', 'missed'])).toBe('not_kept');
    expect(classifyAppearance(true, ['pending', 'uncaptured'])).toBe('not_kept');
  });
  it('is undecided while an obligation is pending and none has failed', () => {
    expect(classifyAppearance(true, ['kept', 'pending'])).toBe('pending');
  });
});

describe('rate', () => {
  it('is null for an empty denominator', () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(78, 100)).toBe(0.78);
  });
});
