// `system.capture.retention` and `capture.retention` (#43; docs/product/09 §8). The system job runs
// daily at 02:00 IST. It has no workspace and `capture` is under FORCE row-level security, so it
// lists the workspaces with raw objects past their `ttl_at` (ids only) through the owner-defined
// `app_capture_retention_targets` function (0053) and queues `capture.retention` for each.
// `capture.retention` deletes that workspace's expired raw objects, removes their blob rows and
// nulls `raw_storage_key` (derived data remains); a discarded capture is due at once, so its raw
// object goes at the next run. Idempotent: swept rows no longer match.
import { CAPTURE_JOB_NAMES } from '@causedeck/capture';
import { serverEnv } from '@causedeck/config/env';
import { createObjectStoreFromEnv, type ObjectStore } from '@causedeck/storage';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { sweepExpiredCaptures } from '../../capture/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { getProducer } from '../producer.ts';

export const captureRetentionSchema = z.object({ workspaceId: workspaceIdSchema });

let defaultStore: ObjectStore | undefined;

/** Send one `capture.retention` job as the registry's `enqueue` does. */
async function enqueueCaptureRetention(workspaceId: string): Promise<unknown> {
  const data = captureRetentionSchema.parse({ workspaceId });
  const sender = await getProducer();
  return sender.send(CAPTURE_JOB_NAMES.retention, data, {
    singletonKey: `capture-retention:${data.workspaceId}`,
    group: { id: data.workspaceId },
  });
}

/** Queue `capture.retention` for every workspace with expired raw objects. Exported for tests. */
export async function runCaptureRetentionSchedule(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: { enqueue?: (workspaceId: string) => Promise<unknown>; now?: () => Date } = {},
): Promise<string[]> {
  const send = deps.enqueue ?? enqueueCaptureRetention;
  const now = deps.now?.() ?? new Date();
  const rows = await ctx.db.execute<{ workspace_id: string }>(
    sql`select workspace_id::text from app_capture_retention_targets(${now.toISOString()}::timestamptz)`,
  );
  const workspaces = rows.map((row) => row.workspace_id);
  for (const workspaceId of workspaces) await send(workspaceId);
  ctx.log.info({ enqueued: workspaces.length }, 'capture retention scheduled');
  return workspaces;
}

export const systemCaptureRetention = defineJob({
  name: CAPTURE_JOB_NAMES.retentionTick,
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'capture-retention', policy: 'stately' },
  schedule: { cron: '0 2 * * *', payload: {} },
  handler: async (ctx) => {
    await runCaptureRetentionSchedule(ctx);
  },
});

export const captureRetention = defineJob({
  name: CAPTURE_JOB_NAMES.retention,
  schema: captureRetentionSchema,
  concurrency: 2,
  singleton: { key: (payload) => `capture-retention:${payload.workspaceId}` },
  handler: async (ctx, { workspaceId }) => {
    const { deleted } = await sweepExpiredCaptures(
      { db: ctx.db, store: (defaultStore ??= createObjectStoreFromEnv(serverEnv())) },
      workspaceId,
    );
    ctx.log.info({ deleted }, 'expired capture raw objects deleted');
  },
});
