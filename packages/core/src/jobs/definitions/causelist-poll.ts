// `system.causelist.poll` (#482, D-048 tier 2): fetches the Karnataka HC public cause lists through
// the governed fetch layer and stages the rows that match each member's watches as proposals. It
// runs at the KHC publication times (cron evaluated in `Asia/Kolkata` by the worker): the evening
// advance list and the morning daily list. It has no workspace, so it is `system.*` by rule and
// reads watches through the owner-defined `app_cause_list_watch_targets` function (0067). It does
// nothing while the flag `court.khc_a2` is off or the source is uncleared (`pollCauseList`). Only
// counts are logged. Core never imports `@causedeck/fetch` (spike §2): the worker wires the governed
// fetcher through `setCauseListFetcherFactory`.
import { z } from 'zod';

import {
  pollCauseList,
  type ListFetcher,
  type PollCauseListDeps,
  type PollCauseListReport,
} from '../../court/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

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

/** Poll once with the wired governed fetcher (or `deps.fetcher` in tests). */
export async function runCauselistPoll(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: Partial<
    Pick<PollCauseListDeps, 'clock' | 'fetcher' | 'parser' | 'flagEnabled' | 'policy'>
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
