import { describe, expect, it } from 'vitest';

import { MIN_CELL_SIZE, summariseCells, type HearingFact, type ProceedingFact } from './index.ts';

const matter = (over: Partial<ProceedingFact> = {}): ProceedingFact => ({
  forumId: 'f1',
  caseTypeCode: 'WP',
  stage: 'admission',
  filedOn: '2026-01-10',
  firstListedOn: '2026-01-20',
  disposedOn: null,
  ...over,
});

const hearing = (adjourned: boolean): HearingFact => ({
  forumId: 'f1',
  caseTypeCode: 'WP',
  stage: 'admission',
  heldOn: '2026-02-01',
  adjourned,
});

const many = <T>(count: number, make: (i: number) => T): T[] =>
  Array.from({ length: count }, (_, i) => make(i));

describe('summariseCells', () => {
  it('computes median delay, adjournment rate, median disposal time and backlog', () => {
    const matters = [
      ...many(3, (i) =>
        matter({ firstListedOn: `2026-01-${String(11 + i * 2).padStart(2, '0')}` }),
      ),
      ...many(2, () => matter({ firstListedOn: '2026-01-30' })),
      ...many(5, () => matter({ disposedOn: '2026-03-01' })),
    ];
    const hearings = [...many(2, () => hearing(true)), ...many(3, () => hearing(false))];
    const [cell, ...rest] = summariseCells(matters, hearings);
    expect(rest).toEqual([]);
    expect(cell?.period).toBe('2026');
    // delays: 1, 3, 5, 20, 20 and ten (the disposed ones) at 10 days -> median 10
    expect(cell?.listingDelayDays).toEqual({ value: 10, n: 10 });
    expect(cell?.adjournmentRate).toEqual({ value: 0.4, n: 5 });
    expect(cell?.disposalDays).toEqual({ value: 50, n: 5 });
    expect(cell?.backlog).toEqual({ value: 5, n: 5 });
    expect(cell?.suppressed).toBe(false);
  });

  it('shows a metric at the minimum size and withholds it one below', () => {
    const at = summariseCells(
      many(MIN_CELL_SIZE, () => matter()),
      [],
    )[0];
    expect(at?.listingDelayDays.value).toBe(10);
    const below = summariseCells(
      many(MIN_CELL_SIZE - 1, () => matter()),
      [],
    )[0];
    expect(below?.listingDelayDays).toEqual({ value: null, n: null });
    expect(below?.backlog).toEqual({ value: null, n: null });
    expect(below?.suppressed).toBe(true);
  });

  it('never carries a value or count for a withheld metric', () => {
    const cells = summariseCells(
      many(2, () => matter({ disposedOn: '2026-02-01' })),
      many(3, () => hearing(true)),
    );
    for (const cell of cells) {
      for (const m of [
        cell.listingDelayDays,
        cell.adjournmentRate,
        cell.disposalDays,
        cell.backlog,
      ]) {
        expect(m).toEqual({ value: null, n: null });
      }
      expect(cell.suppressed).toBe(true);
    }
  });

  it('keeps forums, case types and stages apart', () => {
    const matters = [
      ...many(5, () => matter()),
      ...many(5, () => matter({ caseTypeCode: 'CRP' })),
      ...many(2, () => matter({ stage: 'final' })),
    ];
    const cells = summariseCells(matters, []);
    expect(cells).toHaveLength(3);
    expect(cells.filter((c) => !c.suppressed)).toHaveLength(2);
  });

  it('has no judge, bench or party field on a cell', () => {
    const cell = summariseCells(
      many(5, () => matter()),
      [],
    )[0];
    expect(Object.keys(cell ?? {}).sort()).toEqual(
      [
        'adjournmentRate',
        'backlog',
        'caseTypeCode',
        'disposalDays',
        'forumId',
        'listingDelayDays',
        'period',
        'stage',
        'suppressed',
      ].sort(),
    );
  });
});
