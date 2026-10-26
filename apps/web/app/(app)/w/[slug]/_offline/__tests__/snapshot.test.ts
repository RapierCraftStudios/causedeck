import type { Brief, CourtDay } from '@causedeck/validators';
import { describe, expect, it, vi } from 'vitest';

import type { BoardData } from '../../_court-day/load-court-day.ts';
import { buildSnapshot, datesBetween, daysInRange } from '../snapshot.ts';

const L1 = '00000000-0000-4000-8000-000000000001';
const L2 = '00000000-0000-4000-8000-000000000002';
const M1 = '00000000-0000-4000-8000-0000000000a1';
const M2 = '00000000-0000-4000-8000-0000000000a2';
const OLD = '00000000-0000-4000-8000-0000000000ff';

function board(date: string, items: { listingId: string; matterId: string }[]): BoardData {
  const day = {
    date,
    scope: 'mine',
    complexes: [{ halls: [{ lists: [{ items }] }] }],
    expectedNotListed: [],
    freshness: null,
  } as unknown as CourtDay;
  return { day, clashes: [], diffs: [], failures: [] };
}

const brief = (listingId: string) => ({ listing_id: listingId }) as Brief;
const known = { matterIds: [], listingIds: [], memberIds: [] };

describe('datesBetween', () => {
  it('is inclusive and counts a week as seven days', () => {
    expect(datesBetween('2030-01-30', '2030-02-02')).toEqual([
      '2030-01-30',
      '2030-01-31',
      '2030-02-01',
      '2030-02-02',
    ]);
    expect(daysInRange('2030-01-01', '2030-01-07')).toBe(7);
    expect(daysInRange('2030-01-01', '2030-01-08')).toBe(8);
    expect(datesBetween('2030-01-02', '2030-01-01')).toEqual([]);
  });
});

describe('buildSnapshot', () => {
  const now = () => new Date('2030-01-01T00:00:00Z');

  it('skips a listing whose brief is refused and purges what the snapshot no longer has', async () => {
    const assemble = vi.fn((id: string) => Promise.resolve(id === L1 ? brief(L1) : null));
    const snap = await buildSnapshot(
      {
        from: '2030-01-01',
        to: '2030-01-01',
        known: { matterIds: [M1, M2, OLD], listingIds: [L1, L2, OLD], memberIds: ['m1', 'gone'] },
      },
      {
        loadDay: (d) =>
          Promise.resolve(
            board(d, [
              { listingId: L1, matterId: M1 },
              { listingId: L2, matterId: M2 },
            ]),
          ),
        assemble,
        memberIdsOf: () => Promise.resolve(['m1']),
        now,
      },
    );
    expect(snap.briefs.map((b) => b.listing_id)).toEqual([L1]);
    expect(snap.purge).toEqual({
      listingIds: [L2, OLD],
      matterIds: [OLD],
      memberIds: ['gone'],
    });
    expect(snap.generatedAt).toBe('2030-01-01T00:00:00.000Z');
  });

  it('assembles a listing shown on two days once', async () => {
    const assemble = vi.fn((id: string) => Promise.resolve(brief(id)));
    await buildSnapshot(
      { from: '2030-01-01', to: '2030-01-02', known },
      {
        loadDay: (d) => Promise.resolve(board(d, [{ listingId: L1, matterId: M1 }])),
        assemble,
        memberIdsOf: () => Promise.resolve([]),
        now,
      },
    );
    expect(assemble).toHaveBeenCalledTimes(1);
  });
});
