import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StatusChanges } from '../../case-watch/index.ts';
import { SourceNotCleared } from '../../sources/index.ts';

const lookup = vi.hoisted(() => ({ run: vi.fn(), touch: vi.fn() }));
const alerts = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('../../case-watch/lookup.ts', () => ({
  runCaseStatusLookup: lookup.run,
  touchWatchPolled: lookup.touch,
}));
vi.mock('../../case-watch/alerts.ts', () => ({ notifyStatusChanges: alerts.notify }));

const { runStatusPoll, statusPoll, STATUS_POLL_CRON } = await import('./status-poll.ts');

const log = { info: vi.fn(), warn: vi.fn() };
const fetcher = { fetchSource: vi.fn() };
const enqueueDelivery = vi.fn();
const ctx = { db: {} as never, log: log as never };

const watch = (n: number, advocate = 'adv-1', source = 'src-1') => ({
  watchId: `w-${String(n)}`,
  workspaceId: 'ws-1',
  advocateUserId: advocate,
  sourceId: source,
});

const changes: StatusChanges = {
  nextHearingDate: { from: null, to: '2026-11-01' },
  stage: null,
  bench: null,
  newOrders: [],
};

const unchanged = {
  outcome: 'unchanged',
  snapshotId: null,
  changes: null,
  proposals: 0,
  firstSnapshot: false,
  matterId: 'm-1',
};

const run = (
  due: ReturnType<typeof watch>[],
  caps?: { perAdvocate?: number; perSource?: number },
) =>
  runStatusPoll(ctx, {
    fetcher,
    enqueueDelivery,
    freeAlerts: {},
    listDue: () => Promise.resolve(due),
    ...(caps === undefined ? {} : { caps }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  lookup.run.mockResolvedValue(unchanged);
  lookup.touch.mockResolvedValue(undefined);
  alerts.notify.mockResolvedValue(1);
});

describe('runStatusPoll', () => {
  it('runs each due watch as its own advocate in its own workspace, so every lookup is for their own matter', async () => {
    const report = await run([watch(1, 'adv-1'), watch(2, 'adv-2')]);
    expect(report).toMatchObject({ due: 2, polled: 2, unchanged: 2, failed: 0 });
    expect(lookup.run).toHaveBeenCalledTimes(2);
    expect(lookup.run.mock.calls[0]?.[1]).toEqual({ userId: 'adv-1', workspaceId: 'ws-1' });
    expect(lookup.run.mock.calls[0]?.[2]).toEqual({ watchId: 'w-1' });
    expect(lookup.run.mock.calls[1]?.[1]).toEqual({ userId: 'adv-2', workspaceId: 'ws-1' });
  });

  it('caps the lookups per advocate and per source and leaves the rest due', async () => {
    const perAdvocate = await run([watch(1), watch(2), watch(3)], { perAdvocate: 2 });
    expect(perAdvocate).toMatchObject({ polled: 2, deferred: 1 });
    vi.clearAllMocks();
    lookup.run.mockResolvedValue(unchanged);
    const perSource = await run([watch(1, 'a'), watch(2, 'b'), watch(3, 'c')], { perSource: 1 });
    expect(perSource).toMatchObject({ polled: 1, deferred: 2 });
    expect(lookup.touch).not.toHaveBeenCalled();
  });

  it('defers on a fetch-layer rate limit without marking the watch polled', async () => {
    lookup.run.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'FETCH_DENIED', reason: 'advocate_rate_limited' }),
    );
    const report = await run([watch(1), watch(2), watch(3, 'adv-2')]);
    expect(report).toMatchObject({ polled: 1, deferred: 2, failed: 0 });
    expect(lookup.run).toHaveBeenCalledTimes(2);
    expect(lookup.touch).not.toHaveBeenCalled();

    vi.clearAllMocks();
    lookup.run.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'FETCH_DENIED', reason: 'source_rate_limited' }),
    );
    const bySource = await run([watch(1), watch(2, 'adv-2')]);
    expect(bySource).toMatchObject({ polled: 0, deferred: 2 });
    expect(lookup.run).toHaveBeenCalledTimes(1);
  });

  it('skips the rest of a killed or uncleared source (the kill switch) and still polls the others', async () => {
    lookup.run.mockRejectedValueOnce(new SourceNotCleared('killed', 'src-1'));
    const report = await run([watch(1), watch(2, 'adv-2'), watch(3, 'adv-1', 'src-2')]);
    expect(report).toMatchObject({ skipped: 2, polled: 1, failed: 0 });
    expect(lookup.run).toHaveBeenCalledTimes(2);
    expect(lookup.run.mock.calls[1]?.[2]).toEqual({ watchId: 'w-3' });
  });

  it('advances the cadence when nothing was stored (not found) or a lookup fails, and keeps going', async () => {
    lookup.run
      .mockResolvedValueOnce({ ...unchanged, outcome: 'not_found' })
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce(unchanged);
    const report = await run([watch(1, 'a'), watch(2, 'b'), watch(3, 'c')]);
    expect(report).toMatchObject({ polled: 2, failed: 1, unchanged: 1 });
    expect(lookup.touch.mock.calls.map((c) => c[2] as string)).toEqual(['w-1', 'w-2']);
    expect(log.warn).toHaveBeenCalledWith(
      { watchId: 'w-2', error: 'Error' },
      'status poll lookup failed',
    );
  });

  it('alerts the advocate on a changed snapshot, passing along whether it was the first', async () => {
    lookup.run.mockResolvedValueOnce({
      outcome: 'changed',
      snapshotId: 's-1',
      changes,
      proposals: 1,
      firstSnapshot: false,
      matterId: 'm-1',
    });
    const report = await run([watch(1)]);
    expect(report).toMatchObject({ changed: 1, alerts: 1 });
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({ enqueueDelivery }),
      { userId: 'adv-1', workspaceId: 'ws-1' },
      { snapshotId: 's-1', matterId: 'm-1', changes, firstSnapshot: false },
    );
  });

  it('runs with no fetcher wired when nothing is due', async () => {
    const report = await runStatusPoll(ctx, { listDue: () => Promise.resolve([]) });
    expect(report.due).toBe(0);
  });
});

describe('statusPoll', () => {
  it('is a scheduled hourly system job', () => {
    expect(statusPoll.name).toBe('system.status.poll');
    expect(statusPoll.schedule?.cron).toBe(STATUS_POLL_CRON);
    expect(STATUS_POLL_CRON).toBe('15 * * * *');
  });
});
