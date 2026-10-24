// `system.causelist.poll` (#482, D-048 tier 2): fetches the Karnataka HC public cause lists through
// the governed fetch layer and stages the rows that match each member's watches as proposals. It
// runs at the KHC publication times (cron evaluated in `Asia/Kolkata` by the worker): the evening
// advance list and the morning daily list. It has no workspace, so it is `system.*` by rule and
// reads watches through the owner-defined `app_cause_list_watch_targets` function (0068). It does
// nothing while the flag `court.khc-a2` is off or the source is uncleared (`pollCauseList`). Only
// counts are logged. Core never imports `@causedeck/fetch` (spike §2): the worker wires the governed
// fetcher through `setCauseListFetcherFactory`.
import { z } from 'zod';

import {
  pollCauseList,
  type ListFetcher,
  type PollCauseListDeps,
  type PollCauseListReport,
} from '../../court/index.ts';
import { emitWebhookEvent } from '../../webhooks/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';
import { getProducer } from '../producer.ts';

import { webhookDeliveryKey, webhookDeliverSchema } from './webhook-deliver.ts';

/** Evening advance list (18:30 IST) and morning daily list (07:30 IST). */
export const CAUSELIST_POLL_CRON = '30 7,18 * * *';

/** Builds the governed fetcher for one poll from the job's db (the worker supplies it at startup). */
export type CauseListFetcherFactory = (db: JobContext['db']) => ListFetcher;

let fetcherFactory: CauseListFetcherFactory | null = null;

/** Wiring point: the worker passes a factory over `@causedeck/fetch`; `null` unwires it (tests). */
export function setCauseListFetcherFactory(factory: CauseListFetcherFactory | null): void {
  fetcherFactory = factory;
}

/** Without a wired fetcher the poll still checks the flag, the source and the watchers, and fails loudly only if it must fetch. */
const unwiredFetcher: ListFetcher = {
  fetchSource: () =>
    Promise.reject(new Error('cause list poll: no fetcher wired (setCauseListFetcherFactory)')),
};

/** Send one `webhook.deliver` job (the registry imports this file, so it cannot call `enqueue`). */
export async function enqueueWebhookDelivery(job: {
  workspaceId: string;
  deliveryId: string;
}): Promise<unknown> {
  const data = webhookDeliverSchema.parse(job);
  const sender = await getProducer();
  return sender.send('webhook.deliver', data, {
    singletonKey: webhookDeliveryKey(data),
    group: { id: data.workspaceId },
  });
}

/** Poll once with the wired governed fetcher (or `deps.fetcher` in tests). */
export async function runCauselistPoll(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: Partial<
    Pick<PollCauseListDeps, 'clock' | 'fetcher' | 'parser' | 'flagEnabled' | 'policy' | 'onMatch'>
  > = {},
): Promise<PollCauseListReport> {
  const clock = deps.clock ?? { now: () => new Date() };
  const fetcher = deps.fetcher ?? fetcherFactory?.(ctx.db) ?? unwiredFetcher;
  const report = await pollCauseList({
    db: ctx.db,
    fetcher,
    clock,
    log: (event, counts) => {
      ctx.log.info({ ...counts }, event);
    },
    onMatch:
      deps.onMatch ??
      ((match) =>
        emitWebhookEvent(
          { db: ctx.db, enqueue: enqueueWebhookDelivery },
          {
            workspaceId: match.workspaceId,
            type: 'causelist.matched',
            eventKey: `causelist:${match.publicationId}`,
            sourceId: match.sourceId,
            changes: ['cause_list_match'],
            publicationId: match.publicationId,
            matchCount: match.matchCount,
          },
        )),
    ...(deps.parser === undefined ? {} : { parser: deps.parser }),
    ...(deps.flagEnabled === undefined ? {} : { flagEnabled: deps.flagEnabled }),
    ...(deps.policy === undefined ? {} : { policy: deps.policy }),
  });
  ctx.log.info({ ...report }, 'cause list poll complete');
  return report;
}

export const causelistPoll = defineJob({
  name: 'system.causelist.poll',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  retry: { limit: 3 },
  singleton: { key: () => 'causelist-poll', policy: 'stately' },
  schedule: { cron: CAUSELIST_POLL_CRON, payload: {} },
  handler: async (ctx) => {
    await runCauselistPoll(ctx);
  },
});
