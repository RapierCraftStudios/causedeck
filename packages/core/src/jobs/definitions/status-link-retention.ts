// `system.status-link.retention` (#88, ADR 0049): daily at 03:45 IST, clears the payload of status
// links that expired more than 30 days ago. It has no workspace and `status_link` is under FORCE
// row-level security, so it lists the workspaces (ids only) through the owner-defined
// `app_status_link_purge_targets` function and sweeps each in its own scope. Idempotent. It never
// reads the legal-gated flag: deleting expired data is not the feature.
import { z } from 'zod';

import { purgeExpiredStatusLinks, statusLinkPurgeTargets } from '../../status-links/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

export interface StatusLinkRetentionReport {
  workspaces: number;
  purged: number;
}

/** Sweep every workspace with long-expired links. Exported for tests. */
export async function runStatusLinkRetention(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: { now?: () => Date } = {},
): Promise<StatusLinkRetentionReport> {
  const now = deps.now?.() ?? new Date();
  const targets = await statusLinkPurgeTargets(ctx.db, now);
  let purged = 0;
  for (const workspaceId of targets) {
    purged += (await purgeExpiredStatusLinks({ db: ctx.db, now: () => now }, workspaceId)).purged;
  }
  ctx.log.info({ workspaces: targets.length, purged }, 'status link retention sweep');
  return { workspaces: targets.length, purged };
}

export const statusLinkRetention = defineJob({
  name: 'system.status-link.retention',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'status-link-retention', policy: 'stately' },
  schedule: { cron: '45 3 * * *', payload: {} },
  handler: async (ctx) => {
    await runStatusLinkRetention(ctx);
  },
});
