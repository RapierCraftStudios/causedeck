// The bench card (#521, D-050): flag off reads nothing and returns null; flag on returns neutral facts only.
import { describe, expect, it, vi } from 'vitest';

const rows = [
  {
    sitting_date: '2026-01-05',
    hall_no: '7',
    items_listed: 12,
    items_heard: 9,
    items_disposed: 7,
    minutes_per_item: '4.50',
  },
];
const withWorkspace = vi.fn(() => Promise.resolve([{ benchId: 'b1', sat: ['A B', 'C D'] }]));
vi.mock('@causedeck/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@causedeck/db')>()),
  withWorkspace: () => withWorkspace(),
}));

const { getBenchCard } = await import('./bench-card.ts');
const actor = { workspaceId: 'w1', userId: 'u1' };

describe('getBenchCard', () => {
  it('returns null and reads nothing while the flag is off', async () => {
    const execute = vi.fn();
    const card = await getBenchCard(
      { db: { execute } as never, flagEnabled: () => Promise.resolve(false) },
      actor,
      'm1',
    );
    expect(card).toBeNull();
    expect(withWorkspace).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns the composition, dates, halls, counts and pace only', async () => {
    const execute = vi.fn(() => Promise.resolve(rows));
    const card = await getBenchCard(
      { db: { execute } as never, flagEnabled: () => Promise.resolve(true) },
      actor,
      'm1',
    );
    expect(card).toEqual({
      benchId: 'b1',
      sat: ['A B', 'C D'],
      sittings: [
        {
          sittingDate: '2026-01-05',
          hallNo: '7',
          itemsListed: 12,
          itemsHeard: 9,
          itemsDisposed: 7,
          minutesPerItem: 4.5,
        },
      ],
    });
  });
});
