import { describe, expect, it } from 'vitest';

import { MIN_CELL_SIZE, UNLISTED_STAGE, type ProceedingFact } from './index.ts';
import { summariseExpectedTimeline } from './timeline.ts';

const fact = (over: Partial<ProceedingFact> = {}): ProceedingFact => ({
  forumId: 'f1',
  caseTypeCode: 'WP',
  stage: 'admission',
  filedOn: '2026-01-10',
  firstListedOn: '2026-01-20',
  disposedOn: '2026-03-11',
  ...over,
});

const many = (n: number, make: () => ProceedingFact) => Array.from({ length: n }, make);
const target = { forumId: 'f1', caseTypeCode: 'WP', stage: 'admission' };

describe('summariseExpectedTimeline (#655)', () => {
  it('shows median listing delay and time to disposal at the minimum size', () => {
    const t = summariseExpectedTimeline(
      target,
      many(MIN_CELL_SIZE, () => fact()),
    );
    expect(t.listingDelayDays).toEqual({ value: 10, n: 5 });
    expect(t.disposalDays).toEqual({ value: 60, n: 5 });
    expect(t.withheld).toBe(false);
  });

  it('withholds a figure one below the minimum size', () => {
    const t = summariseExpectedTimeline(
      target,
      many(MIN_CELL_SIZE - 1, () => fact()),
    );
    expect(t.listingDelayDays).toEqual({ value: null, n: null });
    expect(t.disposalDays).toEqual({ value: null, n: null });
    expect(t.withheld).toBe(true);
  });

  it('withholds disposal alone when too few matters are disposed', () => {
    const facts = [...many(5, () => fact({ disposedOn: null })), ...many(2, () => fact())];
    const t = summariseExpectedTimeline(target, facts);
    expect(t.listingDelayDays.value).toBe(10);
    expect(t.disposalDays).toEqual({ value: null, n: null });
    expect(t.withheld).toBe(false);
  });

  it('excludes other forums and case types', () => {
    const facts = [
      ...many(3, () => fact()),
      ...many(5, () => fact({ forumId: 'f2' })),
      ...many(5, () => fact({ caseTypeCode: 'CRP' })),
    ];
    expect(summariseExpectedTimeline(target, facts).withheld).toBe(true);
  });

  it('narrows to the stage of a listed matter and spans stages for an unlisted one', () => {
    const facts = [...many(3, () => fact()), ...many(3, () => fact({ stage: 'final' }))];
    const listed = summariseExpectedTimeline(target, facts);
    expect(listed.byStage).toBe(true);
    expect(listed.withheld).toBe(true);
    const unlisted = summariseExpectedTimeline({ ...target, stage: UNLISTED_STAGE }, facts);
    expect(unlisted.byStage).toBe(false);
    expect(unlisted.listingDelayDays).toEqual({ value: 10, n: 6 });
  });

  it('carries no judge, bench or party field', () => {
    const t = summariseExpectedTimeline(target, []);
    expect(Object.keys(t).sort()).toEqual([
      'byStage',
      'caseTypeCode',
      'disposalDays',
      'forumId',
      'listingDelayDays',
      'stage',
      'withheld',
    ]);
  });
});
