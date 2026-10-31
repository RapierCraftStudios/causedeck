// `system.status.poll` (#592, part 4 of #483, D-048 tier 4 as amended): every hour, run the case
// watches that are due as delegated lookups through the governed fetch layer, each for the
// advocate's own matter (`pollCaseWatches`), and alert the advocate to a new next date, a new order
// or a stage change. The job has no workspace and the watch tables are under FORCE RLS, so it lists
// the due watches (ids only) through the owner-defined `app_case_watch_due` (0074) and runs each in
// its own workspace scope. Per-advocate and per-source caps apply on top of the fetch layer's rate
// limits, and a killed or uncleared source is skipped (the kill switch, `policyFor`). Only ids and
// counts are logged. Core sees the fetcher only as the `StatusFetcher` shape: the worker wires the
// governed fetcher through `setStatusFetcherFactory`.
import type { DeliveryJob } from '@causedeck/notifications';
import { z } from 'zod';

import {
  pollCaseWatches,
  type PollCaseWatchesDeps,
  type PollCaseWatchesReport,
  type StatusFetcher,
} from '../../case-watch/index.ts';
import { createFreeAlertsPollGuard } from '../../free-alerts/index.ts';
import { emitWebhookEvent } from '../../webhooks/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';
import { getProducer } from '../producer.ts';

import { deliveryKey, notificationDeliverSchema } from './notification-deliver.ts';
import { enqueueWebhookDelivery } from './causelist-poll.ts';

/** Hourly at :15 (Asia/Kolkata, evaluated by the worker); a watch cannot be set to poll faster than hourly. */
export const STATUS_POLL_CRON = '15 * * * *';

/** Builds the governed fetcher for one poll from the job's db (the worker supplies it at startup). */
export type StatusFetcherFactory = (db: JobContext['db']) => StatusFetcher;

let fetcherFactory: StatusFetcherFactory | null = null;

/** Wiring point: the worker passes a factory over `@causedeck/fetch`; `null` unwires it (tests). */
export function setStatusFetcherFactory(factory: StatusFetcherFactory | null): void {
  fetcherFactory = factory;
}

/** The wired factory, for sibling jobs that read the same delegated source (`system.orders.poll`). */
export function getStatusFetcherFactory(): StatusFetcherFactory | null {
  return fetcherFactory;
}

/** Without a wired fetcher the poll fails loudly, and only when a lookup must fetch. */
const unwiredFetcher: StatusFetcher = {
  fetchSource: () =>
    Promise.reject(new Error('status poll: no fetcher wired (setStatusFetcherFactory)')),
};

/** Send one `notification.deliver` job as the registry's `enqueue` does (the registry imports this file). */
async function enqueueDelivery(job: DeliveryJob): Promise<unknown> {
  const data = notificationDeliverSchema.parse(job);
  const sender = await getProducer();
  return sender.send('notification.deliver', data, {
    singletonKey: deliveryKey(data),
    group: { id: data.workspaceId },
  });
}

export type StatusPollDeps = Partial<
  Pick<
    PollCaseWatchesDeps,
    'fetcher' | 'policy' | 'listDue' | 'caps' | 'now' | 'enqueueDelivery' | 'onChange'
  > & {
    /** Replaces the free tier's guard (tests); by default it is built on the usage meter. */
    freeAlerts?: Pick<PollCaseWatchesDeps, 'admit' | 'fetcherFor' | 'alertNote'>;
  }
>;

/** The job body. Exported for tests. */
export async function runStatusPoll(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: StatusPollDeps = {},
): Promise<PollCaseWatchesReport> {
  const fetcher = deps.fetcher ?? fetcherFactory?.(ctx.db) ?? unwiredFetcher;
  // The free tier's fetch cost cap (#506): a no-op for paid workspaces and while its flag is off.
  const guard =
    deps.freeAlerts ??
    createFreeAlertsPollGuard(
      { db: ctx.db, ...(deps.now === undefined ? {} : { now: deps.now }) },
      fetcher,
    );
  const report = await pollCaseWatches({
    db: ctx.db,
    fetcher,
    ...(guard.admit === undefined ? {} : { admit: guard.admit }),
    ...(guard.fetcherFor === undefined ? {} : { fetcherFor: guard.fetcherFor }),
    ...(guard.alertNote === undefined ? {} : { alertNote: guard.alertNote }),
    enqueueDelivery: deps.enqueueDelivery ?? enqueueDelivery,
    onChange: (change) =>
      emitWebhookEvent(
        { db: ctx.db, enqueue: enqueueWebhookDelivery },
        {
          workspaceId: change.workspaceId,
          type: change.kinds.includes('order') ? 'order.added' : 'status.changed',
          eventKey: `status:${change.snapshotId}`,
          sourceId: change.sourceId,
          changes: change.kinds,
          matterId: change.matterId,
          watchId: change.watchId,
          snapshotId: change.snapshotId,
        },
      ),
    log: (event, fields) => {
      ctx.log.warn({ ...fields }, event);
    },
    ...(deps.onChange === undefined ? {} : { onChange: deps.onChange }),
    ...(deps.policy === undefined ? {} : { policy: deps.policy }),
    ...(deps.listDue === undefined ? {} : { listDue: deps.listDue }),
    ...(deps.caps === undefined ? {} : { caps: deps.caps }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  ctx.log.info({ ...report }, 'status poll done');
  return report;
}

export const statusPoll = defineJob({
  name: 'system.status.poll',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'status-poll', policy: 'stately' },
  schedule: { cron: STATUS_POLL_CRON, payload: {} },
  timeoutSec: 1800,
  handler: async (ctx) => {
    await runStatusPoll(ctx);
  },
});
