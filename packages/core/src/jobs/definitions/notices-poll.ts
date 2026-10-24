// `system.notices.poll` (#586, D-048): hourly, fetches the notice page of each cleared `notice`
// source through the governed fetch layer, stores new notices with provenance and matches them to
// the workspaces and matters that use their forums (`pollNotices`). It has no workspace, so it is
// `system.*` by rule. An uncleared source is never fetched and is logged as "skipped: not cleared";
// the per-source rate limit is applied by the fetch layer. Only counts are logged. Core never
// imports `@causedeck/fetch` (spike §2): the worker wires the governed fetcher through
// `setNoticeFetcherFactory`.
import type { DeliveryJob } from '@causedeck/notifications';
import { z } from 'zod';

import {
  pollNotices,
  type NoticeFetcher,
  type PollNoticesDeps,
  type PollNoticesReport,
} from '../../notices/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';
import { getProducer } from '../producer.ts';

import { deliveryKey, notificationDeliverSchema } from './notification-deliver.ts';

/** Hourly on the hour (the worker evaluates cron in `Asia/Kolkata`). */
export const NOTICES_POLL_CRON = '0 * * * *';

/** Builds the governed fetcher for one poll from the job's db (the worker supplies it at startup). */
export type NoticeFetcherFactory = (db: JobContext['db']) => NoticeFetcher;

let fetcherFactory: NoticeFetcherFactory | null = null;

/** Wiring point: the worker passes a factory over `@causedeck/fetch`; `null` unwires it (tests). */
export function setNoticeFetcherFactory(factory: NoticeFetcherFactory | null): void {
  fetcherFactory = factory;
}

/** Without a wired fetcher the poll still skips uncleared sources and fails loudly only if it must fetch. */
const unwiredFetcher: NoticeFetcher = {
  fetchSource: () =>
    Promise.reject(new Error('notices poll: no fetcher wired (setNoticeFetcherFactory)')),
};

/** Send one `notification.deliver` job as the registry's `enqueue` does (#587 notice alerts). */
async function enqueueDelivery(job: DeliveryJob): Promise<unknown> {
  const data = notificationDeliverSchema.parse(job);
  const sender = await getProducer();
  return sender.send('notification.deliver', data, {
    singletonKey: deliveryKey(data),
    group: { id: data.workspaceId },
  });
}

/** Poll once with the wired governed fetcher (or `deps.fetcher` in tests). */
export async function runNoticesPoll(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: Partial<
    Pick<PollNoticesDeps, 'fetcher' | 'policy' | 'parsers' | 'sourceId' | 'enqueueDelivery'>
  > = {},
): Promise<PollNoticesReport> {
  const report = await pollNotices({
    db: ctx.db,
    fetcher: deps.fetcher ?? fetcherFactory?.(ctx.db) ?? unwiredFetcher,
    enqueueDelivery: deps.enqueueDelivery ?? enqueueDelivery,
    log: (event, counts) => {
      ctx.log.info({ ...counts }, event);
    },
    ...(deps.policy === undefined ? {} : { policy: deps.policy }),
    ...(deps.parsers === undefined ? {} : { parsers: deps.parsers }),
    ...(deps.sourceId === undefined ? {} : { sourceId: deps.sourceId }),
  });
  ctx.log.info({ ...report }, 'notices poll complete');
  return report;
}

export const noticesPoll = defineJob({
  name: 'system.notices.poll',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  retry: { limit: 3 },
  singleton: { key: () => 'notices-poll', policy: 'stately' },
  schedule: { cron: NOTICES_POLL_CRON, payload: {} },
  handler: async (ctx) => {
    await runNoticesPoll(ctx);
  },
});
