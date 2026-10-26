// `brief.refresh` and `system.brief.refresh-sweep` (#60): reconcile a listing's brief state with the
// docket (a material change clears the prepared mark and emits `brief.stale`). `brief.refresh` takes
// ids only and is singleton per listing; the sweep has no workspace and lists tomorrow's listings and
// those with a confirmed next date within 7 days through the owner-defined
// `app_brief_refresh_targets()` (as `system.portfolio-alert.scan` does), then refreshes each in its
// own workspace scope.
import { db as rootDb } from '@causedeck/db';
import { z } from 'zod';

import { refreshBrief, refreshBriefTargets, type BriefEvents } from '../../briefs/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';

export const BRIEF_REFRESH_JOB_NAME = 'brief.refresh';

export const briefRefreshSchema = z.object({
  workspaceId: workspaceIdSchema,
  listingId: z.uuid(),
});
export type BriefRefreshPayload = z.output<typeof briefRefreshSchema>;

export interface BriefRefreshDeps {
  now?: () => Date;
  events?: BriefEvents;
}

/** The job body. Exported for tests. */
export async function runBriefRefresh(
  ctx: Pick<JobContext, 'db' | 'log'>,
  payload: BriefRefreshPayload,
  deps: BriefRefreshDeps = {},
): Promise<void> {
  const done = await refreshBrief(
    {
      db: ctx.db,
      ...(deps.now ? { now: deps.now } : {}),
      ...(deps.events ? { events: deps.events } : {}),
    },
    payload,
  );
  ctx.log.info({ listingId: payload.listingId, stale: done.stale }, 'brief refreshed');
}

export const briefRefresh = defineJob({
  name: BRIEF_REFRESH_JOB_NAME,
  schema: briefRefreshSchema,
  concurrency: 2,
  singleton: { key: (p) => `brief-refresh:${p.listingId}`, policy: 'short' },
  handler: async (ctx, payload) => {
    await runBriefRefresh(ctx, payload);
  },
});

/** The sweep body. Exported for tests. */
export async function runBriefRefreshSweep(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: BriefRefreshDeps & { db?: typeof rootDb } = {},
) {
  const report = await refreshBriefTargets({
    db: deps.db ?? rootDb,
    log: ctx.log,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.events ? { events: deps.events } : {}),
  });
  ctx.log.info({ ...report }, 'brief refresh sweep done');
  return report;
}

export const briefRefreshSweep = defineJob({
  name: 'system.brief.refresh-sweep',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'brief-refresh-sweep', policy: 'stately' },
  // Evening, 18:00 IST: tomorrow's board is out and advance notice is about a day.
  schedule: { cron: '0 18 * * *', payload: {} },
  timeoutSec: 1800,
  handler: async (ctx) => {
    await runBriefRefreshSweep(ctx);
  },
});
