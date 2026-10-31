// The free alerts tier's fetch cost cap at the poll (#506): a free workspace's delegated lookups
// stop once the month's spend plus the per-lookup ceiling would pass the cap, whatever is due; a
// paid workspace and a dark flag are never capped. The usage meter is replaced by an in-memory
// store with the same idempotency contract, and the source by a fetcher that reports a cost.
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { FetchBudgetStore } from '../../free-alerts/index.ts';

const lookup = vi.hoisted(() => ({ run: vi.fn(), touch: vi.fn() }));
vi.mock('../../case-watch/lookup.ts', () => ({
  runCaseStatusLookup: lookup.run,
  touchWatchPolled: lookup.touch,
}));
vi.mock('../../case-watch/alerts.ts', () => ({ notifyStatusChanges: vi.fn() }));

const { runStatusPoll } = await import('./status-poll.ts');
const { createFreeAlertsPollGuard, FREE_ALERTS_FLAG } = await import('../../free-alerts/index.ts');

const CAP = 100_000;
const limits = {
  maxWatches: 10,
  fetchCostCapMicrosPerMonth: CAP,
  fetchCostCeilingMicros: 40_000,
  fetchCostFloorMicros: 1_000,
};

/** In-memory budget: workspaces in `free` have the allowance, the rest are paid. */
function fakeStore(free: string[]) {
  const spent = new Map<string, number>();
  const seen = new Set<string>();
  const store: FetchBudgetStore = {
    limits: (ws) => Promise.resolve(free.includes(ws) ? limits : null),
    spent: (ws) => Promise.resolve(spent.get(ws) ?? 0),
    add: (ws, micros, key) => {
      if (!seen.has(`${ws}:${key}`)) {
        seen.add(`${ws}:${key}`);
        spent.set(ws, (spent.get(ws) ?? 0) + micros);
      }
      return Promise.resolve();
    },
  };
  return { store, spent };
}

const watch = (n: number, workspaceId: string) => ({
  watchId: `w-${String(n)}`,
  workspaceId,
  advocateUserId: `adv-${String(n)}`,
  sourceId: 'src-1',
});

const unchanged = {
  outcome: 'unchanged',
  snapshotId: null,
  changes: null,
  proposals: 0,
  firstSnapshot: false,
  matterId: 'm-1',
};

let fetches = 0;
const fetcher = {
  fetchSource: vi.fn().mockImplementation(() => {
    fetches += 1;
    return Promise.resolve({
      body: '',
      provenance: {
        url: 'https://example.test',
        fetchedAt: `2026-11-01T10:00:0${String(fetches)}.000Z`,
        sha256: 'x',
        tierUsed: 'tier2' as never,
        costDollars: 0.03,
      },
    });
  }),
};

const ctx = { db: {} as never, log: { info: vi.fn(), warn: vi.fn() } as never };

function poll(due: ReturnType<typeof watch>[], free: string[], flag = true) {
  const { store, spent } = fakeStore(free);
  const guard = createFreeAlertsPollGuard(
    { db: {} as never, store, flagEnabled: () => Promise.resolve(flag) },
    fetcher,
  );
  return runStatusPoll(ctx, {
    fetcher,
    enqueueDelivery: vi.fn(),
    freeAlerts: guard,
    listDue: () => Promise.resolve(due),
  }).then((report) => ({ report, spent }));
}

beforeEach(() => {
  vi.clearAllMocks();
  fetches = 0;
  lookup.touch.mockResolvedValue(undefined);
  // The lookup fetches once through the fetcher the poll gives it, as the real one does.
  lookup.run.mockImplementation(
    async (deps: { fetcher: typeof fetcher }, actor: { workspaceId: string }) => {
      await deps.fetcher.fetchSource('src-1', `https://example.test/${actor.workspaceId}`, {
        delegatedFor: { advocateId: 'a', matterId: 'm' },
      });
      return unchanged;
    },
  );
});

describe('free alerts fetch cost cap at the poll', () => {
  it('stops fetching for a free workspace before its monthly cap, never spending past it', async () => {
    const due = [1, 2, 3, 4, 5].map((n) => watch(n, 'ws-free'));
    const { report, spent } = await poll(due, ['ws-free']);
    // 30k each: admitted at 0, 30k and 60k (60k + 40k ceiling = cap); not at 90k.
    expect(report).toMatchObject({ polled: 3, capped: 2, failed: 0 });
    expect(spent.get('ws-free')).toBe(90_000);
    expect(spent.get('ws-free') ?? 0).toBeLessThanOrEqual(CAP);
    expect(fetcher.fetchSource).toHaveBeenCalledTimes(3);
  });

  it('moves a capped watch to its next cadence so it does not hold a slot every run', async () => {
    const due = [1, 2, 3, 4].map((n) => watch(n, 'ws-free'));
    await poll(due, ['ws-free']);
    expect(lookup.touch.mock.calls.map((c) => c[2] as string)).toEqual(['w-4']);
  });

  it('caps each free workspace on its own budget and never caps a paid one', async () => {
    const due = [
      ...[1, 2, 3, 4].map((n) => watch(n, 'ws-a')),
      ...[5, 6, 7, 8].map((n) => watch(n, 'ws-b')),
      ...[9, 10, 11, 12, 13, 14].map((n) => watch(n, 'ws-paid')),
    ];
    const { report, spent } = await poll(due, ['ws-a', 'ws-b']);
    expect(report).toMatchObject({ polled: 12, capped: 2 });
    expect(spent.get('ws-a')).toBe(90_000);
    expect(spent.get('ws-b')).toBe(90_000);
    expect(spent.has('ws-paid')).toBe(false);
  });

  it('applies no cap while the flag is off', async () => {
    const due = [1, 2, 3, 4, 5].map((n) => watch(n, 'ws-free'));
    const { report, spent } = await poll(due, ['ws-free'], false);
    expect(report).toMatchObject({ polled: 5, capped: 0 });
    expect(spent.size).toBe(0);
  });

  it('counts a replayed fetch once', async () => {
    const { store, spent } = fakeStore(['ws-free']);
    const guard = createFreeAlertsPollGuard(
      { db: {} as never, store, flagEnabled: () => Promise.resolve(true) },
      fetcher,
    );
    fetcher.fetchSource.mockResolvedValue({
      body: '',
      provenance: {
        url: 'u',
        fetchedAt: '2026-11-01T10:00:00.000Z',
        sha256: 'x',
        tierUsed: 'tier2',
        costDollars: 0.03,
      },
    });
    const actor = { workspaceId: 'ws-free', userId: 'a' };
    const opts = { delegatedFor: { advocateId: 'a', matterId: 'm' } };
    await guard.fetcherFor(actor).fetchSource('src-1', 'u', opts);
    await guard.fetcherFor(actor).fetchSource('src-1', 'u', opts);
    expect(spent.get('ws-free')).toBe(30_000);
  });

  it('registers the flag name the guard reads', () => {
    expect(FREE_ALERTS_FLAG).toBe('growth.free-alerts');
  });
});
