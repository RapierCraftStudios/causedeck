// `attention.scan` (#70): nightly 02:00 IST. `system.attention.scan` lists the live workspaces (ids
// and timezone only, through the owner-defined `app_notification_digest_targets`) and enqueues
// `attention.scan` for each; that job runs the detector over the workspace's own graph and logs the
// counts by rule. It is idempotent per workspace and local day (`once`), changes no matter, listing,
// hearing or obligation and sends no message: the flags are read on demand and the end-of-day
// digest (#49) reads a count for each member.
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { scanWorkspaceAttention } from '../../attention/index.ts';
import { localDay } from '../../obligations/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { once } from '../idempotency.ts';
import { getProducer } from '../producer.ts';

import { workspaceTimezone } from './notification-deliver.ts';

export const attentionScanSchema = z.object({ workspaceId: workspaceIdSchema });
export type AttentionScanPayload = z.output<typeof attentionScanSchema>;

const key = (p: AttentionScanPayload) => `attention-scan:${p.workspaceId}`;

export interface AttentionScanScheduleDeps {
  enqueue?: (payload: AttentionScanPayload) => Promise<unknown>;
}

async function enqueueWorkspace(payload: AttentionScanPayload): Promise<unknown> {
  const data = attentionScanSchema.parse(payload);
  const sender = await getProducer();
  return sender.send('attention.scan', data, {
    singletonKey: key(data),
    group: { id: data.workspaceId },
  });
}

export async function runAttentionScanSchedule(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: AttentionScanScheduleDeps = {},
): Promise<number> {
  const send = deps.enqueue ?? enqueueWorkspace;
  const rows = await ctx.db.execute<{ workspace_id: string }>(
    sql`select workspace_id::text from app_notification_digest_targets()`,
  );
  for (const row of rows) await send({ workspaceId: row.workspace_id });
  ctx.log.info({ workspaces: rows.length }, 'attention scan scheduled');
  return rows.length;
}

export const attentionScanSchedule = defineJob({
  name: 'system.attention.scan',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'attention-scan', policy: 'stately' },
  // Daily 02:00 in Asia/Kolkata.
  schedule: { cron: '0 2 * * *', payload: {} },
  handler: async (ctx) => {
    await runAttentionScanSchedule(ctx);
  },
});

export const attentionScan = defineJob({
  name: 'attention.scan',
  schema: attentionScanSchema,
  concurrency: 2,
  retry: { limit: 3, delaySec: 60, backoff: true, delayMaxSec: 1800 },
  singleton: { key },
  handler: async (ctx, payload) => {
    const timeZone = await workspaceTimezone(ctx, payload.workspaceId);
    const today = localDay(new Date(), timeZone);
    const result = await once(ctx, `scan:${today}`, () =>
      scanWorkspaceAttention({ db: ctx.db, timeZone }, payload.workspaceId),
    );
    if (result.skipped) return;
    ctx.log.info({ workspaceId: payload.workspaceId, counts: result.value }, 'attention scan done');
  },
});
