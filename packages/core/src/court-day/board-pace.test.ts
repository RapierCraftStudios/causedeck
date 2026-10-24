// Call-time estimates use the internal bench-facts pace (#521, D-050, R9): with thin own history the
// stored per-day pace backs the estimate; with enough own samples it is not read at all.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadBenchPace = vi.fn<(...args: unknown[]) => Promise<number[]>>();
const mine = [
  {
    listingId: 'l1',
    matterId: 'm1',
    itemNo: '10',
    hallNo: '3',
    forumCode: 'in.ka.karnataka-hc.bengaluru',
  },
];

vi.mock('@causedeck/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@causedeck/db')>()),
  withWorkspace: () => Promise.resolve(mine),
}));
vi.mock('@causedeck/intelligence', () => ({
  loadBenchPace: (...args: unknown[]) => loadBenchPace(...args),
  refreshBenchFacts: vi.fn(),
}));

const { getLiveHalls } = await import('./board.ts');

const now = new Date('2026-10-19T06:00:00Z');
const obs = (itemNo: string, minutesAgo: number) => ({
  itemNo,
  status: 'sitting' as const,
  passedOver: [],
  observedAt: new Date(now.getTime() - minutesAgo * 60_000),
});
const dbWith = (history: unknown[]) =>
  ({
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => Promise.resolve(history) }) }),
    }),
  }) as never;
const actor = { workspaceId: 'w1', userId: 'u1' };
const run = (history: unknown[]) =>
  getLiveHalls(
    { db: dbWith(history), clock: { now: () => now }, flagEnabled: () => Promise.resolve(true) },
    actor,
  );

describe('getLiveHalls pace source', () => {
  beforeEach(() => loadBenchPace.mockReset());

  it('backs a thin hall with the stored bench pace', async () => {
    loadBenchPace.mockResolvedValue([4, 4, 4]);
    const [hall] = await run([obs('5', 1)]);
    expect(hall?.items[0]?.window?.medianMinutesPerItem).toBe(4);
    expect(hall?.items[0]?.window?.samples).toBe(3);
  });

  it('falls back to raw observations when nothing is stored', async () => {
    loadBenchPace.mockResolvedValue([]);
    const [thin] = await run([obs('5', 1)]);
    expect(thin?.items[0]?.window).toBeNull();
    const [own] = await run([obs('1', 40), obs('3', 20), obs('4', 10), obs('5', 1)]);
    expect(own?.items[0]?.window?.samples).toBe(3);
  });

  it('does not read the store when own samples suffice', async () => {
    await run([obs('1', 40), obs('3', 30), obs('4', 20), obs('5', 10), obs('6', 1)]);
    expect(loadBenchPace).not.toHaveBeenCalled();
  });
});
