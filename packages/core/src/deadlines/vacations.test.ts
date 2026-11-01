import { describe, expect, it } from 'vitest';

import { closedReason, mergeVacations, type CourtCalendar, type VacationRange } from './index.ts';

const v = (from: string, to: string, name: string): VacationRange => ({ from, to, name });

describe('mergeVacations precedence (#650)', () => {
  it('keeps the static table when no notice states a range', () => {
    const table = [v('2026-06-01', '2026-06-30', 'static summer')];
    expect(mergeVacations(table, [])).toEqual(table);
  });

  it('adds a notice range that overlaps nothing static', () => {
    expect(
      mergeVacations(
        [v('2026-06-01', '2026-06-30', 'static summer')],
        [v('2026-12-24', '2027-01-03', 'notice winter')],
      ).map((r) => r.name),
    ).toEqual(['static summer', 'notice winter']);
  });

  it('lets a notice range replace every static range it overlaps, even by one day', () => {
    const merged = mergeVacations(
      [v('2026-05-25', '2026-06-30', 'static a'), v('2026-07-01', '2026-07-05', 'static b')],
      [v('2026-06-10', '2026-07-01', 'notice')],
    );
    expect(merged).toEqual([v('2026-06-10', '2026-07-01', 'notice')]);
  });

  it('keeps notice ranges that overlap each other and sorts by start', () => {
    const merged = mergeVacations(
      [],
      [v('2026-06-10', '2026-06-20', 'second'), v('2026-06-01', '2026-06-12', 'first')],
    );
    expect(merged.map((r) => r.name)).toEqual(['first', 'second']);
  });
});

describe('closedReason with merged vacations (#650)', () => {
  it('closes a day inside a notice range and reopens one a notice moved out of the table', () => {
    const calendar: CourtCalendar = {
      forumCode: 'x',
      weeklyOffs: [0],
      holidays: new Map(),
      vacations: mergeVacations(
        [v('2026-06-01', '2026-06-30', 'static summer')],
        [v('2026-06-01', '2026-06-15', 'notice summer')],
      ),
    };
    expect(closedReason(calendar, '2026-06-10')).toBe('notice summer');
    expect(closedReason(calendar, '2026-06-20')).toBeNull();
  });
});
