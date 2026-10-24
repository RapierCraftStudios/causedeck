// `system.orders.poll` (#494, D-048): every hour, ingest the new daily orders of watched matters.
// For each due watch (the same list, caps and kill switch as `system.status.poll`) the latest
// snapshot's order links not yet captured are fetched as delegated lookups through the governed
// fetch layer and stored as captures, so `extraction.extract-order` reads them and stages their
// directions as L2 proposals the lawyer confirms. The job has no workspace; `pollOrders` lists the
// due watches through `app_case_watch_due` and works in each one's own workspace scope. Only ids and
// counts are logged. The worker wires the governed fetcher through `setStatusFetcherFactory`.
import { serverEnv } from '@causedeck/config/env';
import { createObjectStoreFromEnv, type ObjectStore } from '@causedeck/storage';
import { z } from 'zod';

import {
  pollOrders,
  type PollOrdersDeps,
  type PollOrdersReport,
  type StatusFetcher,
} from '../../case-watch/index.ts';
import { captureConfigFromProcess } from '../../capture/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

import { enqueueCaptureProcess } from './capture-process.ts';
import { enqueueCaptureScan } from './capture-scan.ts';
import { getStatusFetcherFactory } from './status-poll.ts';

/** Hourly at :45 (Asia/Kolkata, evaluated by the worker), after the status poll at :15 has stored new snapshots. */
export const ORDERS_POLL_CRON = '45 * * * *';

let defaultStore: ObjectStore | undefined;

const unwiredFetcher: StatusFetcher = {
  fetchSource: () =>
    Promise.reject(new Error('orders poll: no fetcher wired (setStatusFetcherFactory)')),
};

export type OrdersPollDeps = Partial<
  Pick<PollOrdersDeps, 'fetcher' | 'policy' | 'listDue' | 'caps' | 'now' | 'store' | 'jobs'>
>;

/** The job body. Exported for tests. */
export async function runOrdersPoll(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: OrdersPollDeps = {},
): Promise<PollOrdersReport> {
  const report = await pollOrders({
    db: ctx.db,
    fetcher: deps.fetcher ?? getStatusFetcherFactory()?.(ctx.db) ?? unwiredFetcher,
    store: deps.store ?? (defaultStore ??= createObjectStoreFromEnv(serverEnv())),
    config: captureConfigFromProcess(),
    jobs: deps.jobs ?? { scan: enqueueCaptureScan, process: enqueueCaptureProcess },
    log: (event, fields) => {
      ctx.log.warn({ ...fields }, event);
    },
    ...(deps.policy === undefined ? {} : { policy: deps.policy }),
    ...(deps.listDue === undefined ? {} : { listDue: deps.listDue }),
    ...(deps.caps === undefined ? {} : { caps: deps.caps }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  ctx.log.info({ ...report }, 'orders poll done');
  return report;
}

export const ordersPoll = defineJob({
  name: 'system.orders.poll',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'orders-poll', policy: 'stately' },
  schedule: { cron: ORDERS_POLL_CRON, payload: {} },
  timeoutSec: 1800,
  handler: async (ctx) => {
    await runOrdersPoll(ctx);
  },
});
