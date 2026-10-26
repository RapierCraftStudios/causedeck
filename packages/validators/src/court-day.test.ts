import { describe, expect, it } from 'vitest';

import {
  Clash,
  CourtDayQuery,
  CurrentItemMarker,
  ListDiff,
  SnapshotRow,
  SnapshotListInput,
} from './court-day';

const id = '11111111-1111-4111-8111-111111111111';

describe('court-day schemas', () => {
  it('defaults the scope to mine and rejects unknown keys and bad dates', () => {
    expect(CourtDayQuery.parse({ date: '2026-11-02' }).scope).toBe('mine');
    expect(CourtDayQuery.safeParse({ date: '2026-11-02', scope: 'all' }).success).toBe(false);
    expect(CourtDayQuery.safeParse({ date: '02/11/2026' }).success).toBe(false);
    expect(CourtDayQuery.safeParse({ date: '2026-11-02', extra: 1 }).success).toBe(false);
  });

  it('keeps item numbers as text and needs a positive marker item', () => {
    expect(SnapshotRow.parse({ proceedingKey: 'a', hallNo: '5B', itemNo: '12A', stage: null }));
    expect(
      CurrentItemMarker.safeParse({ hallId: id, listDate: '2026-11-02', currentItem: 0 }).success,
    ).toBe(false);
    expect(
      CurrentItemMarker.safeParse({ hallId: id, listDate: '2026-11-02', currentItem: 7 }).success,
    ).toBe(true);
  });

  it('validates snapshot input and diff output shapes', () => {
    expect(
      SnapshotListInput.safeParse({
        forumId: id,
        listDate: '2026-11-02',
        listType: 'daily',
        rows: [],
      }).success,
    ).toBe(true);
    expect(
      ListDiff.safeParse({
        label: 'changed',
        added: [],
        removed: [],
        moved: [],
        stage_changed: [],
        entries: [],
      }).success,
    ).toBe(true);
    expect(
      ListDiff.safeParse({
        label: 'predicted',
        added: [],
        removed: [],
        moved: [],
        stage_changed: [],
      }).success,
    ).toBe(false);
  });

  it('only allows hall and complex clash kinds', () => {
    const item = { listingId: id, proceedingId: id, forumId: id, hallId: id, itemNo: '1' };
    const clash = {
      kind: 'hall',
      date: '2026-11-02',
      memberId: id,
      items: [item, item],
      statement: 's',
    };
    expect(Clash.safeParse(clash).success).toBe(true);
    expect(Clash.safeParse({ ...clash, kind: 'time' }).success).toBe(false);
  });
});
