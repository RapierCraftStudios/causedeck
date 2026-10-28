// `system.enquiry.retention` (#87, ADR 0047): daily at 03:30 IST, deletes closed enquiries past each
// workspace's `enquiry_retention_months`. It has no workspace and `enquiry` is under FORCE row-level
// security, so it lists the workspaces with closed enquiries (ids only) through the owner-defined
// `app_enquiry_retention_targets` function and sweeps each in its own scope. Idempotent: swept rows
// no longer match. It never reads the legal-gated flag: deleting expired data is not the feature.
import { z } from 'zod';

import { enquiryRetentionTargets, sweepClosedEnquiries } from '../../intake/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

export interface EnquiryRetentionReport {
  workspaces: number;
  deleted: number;
}

/** Sweep every workspace with closed enquiries. Exported for tests. */
export async function runEnquiryRetention(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: { now?: () => Date } = {},
): Promise<EnquiryRetentionReport> {
  const now = deps.now?.() ?? new Date();
  const targets = await enquiryRetentionTargets(ctx.db, now);
  let deleted = 0;
  for (const workspaceId of targets) {
    const result = await sweepClosedEnquiries({ db: ctx.db, now: () => now }, workspaceId);
    deleted += result.deleted;
  }
  ctx.log.info({ workspaces: targets.length, deleted }, 'enquiry retention sweep');
  return { workspaces: targets.length, deleted };
}

export const enquiryRetention = defineJob({
  name: 'system.enquiry.retention',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'enquiry-retention', policy: 'stately' },
  schedule: { cron: '30 3 * * *', payload: {} },
  handler: async (ctx) => {
    await runEnquiryRetention(ctx);
  },
});
