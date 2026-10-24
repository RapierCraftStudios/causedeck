import { beforeEach, describe, expect, it, vi } from 'vitest';

const orders = vi.hoisted(() => ({ poll: vi.fn() }));

vi.mock('../../case-watch/orders.ts', () => ({
  pollOrders: orders.poll,
  MAX_ORDERS_PER_WATCH_PER_RUN: 3,
}));

const { ordersPoll, ORDERS_POLL_CRON, runOrdersPoll } = await import('./orders-poll.ts');
const { setStatusFetcherFactory } = await import('./status-poll.ts');

const log = { info: vi.fn(), warn: vi.fn() };
const ctx = { db: {} as never, log: log as never };
const report = { due: 1, captured: 1, duplicates: 0, deferred: 0, skipped: 0, failed: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  setStatusFetcherFactory(null);
  orders.poll.mockResolvedValue(report);
});

describe('system.orders.poll', () => {
  it('is an hourly, workspace-less singleton', () => {
    expect(ordersPoll.name).toBe('system.orders.poll');
    expect(ordersPoll.schedule?.cron).toBe(ORDERS_POLL_CRON);
    expect(ordersPoll.singleton?.key({})).toBe('orders-poll');
  });

  it('polls with the fetcher the worker wired and logs counts only', async () => {
    const fetcher = { fetchSource: vi.fn() };
    setStatusFetcherFactory(() => fetcher);
    await expect(runOrdersPoll(ctx, { store: {} as never, jobs: {} as never })).resolves.toEqual(
      report,
    );
    expect(orders.poll.mock.calls[0]?.[0].fetcher).toBe(fetcher);
    expect(log.info).toHaveBeenCalledWith({ ...report }, 'orders poll done');
  });

  it('fails loudly on a fetch when no fetcher is wired', async () => {
    await runOrdersPoll(ctx, { store: {} as never, jobs: {} as never });
    const { fetcher } = orders.poll.mock.calls[0]?.[0] as {
      fetcher: { fetchSource: () => Promise<unknown> };
    };
    await expect(fetcher.fetchSource()).rejects.toThrow('no fetcher wired');
  });
});
