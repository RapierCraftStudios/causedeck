// `system.webhook.sweep` (#626, #487 part 3): every few minutes, re-enqueue `webhook.deliver` for
// pending deliveries that are due, which covers an event whose enqueue failed or whose job was
// lost. The job has no workspace and `webhook_delivery` is under FORCE RLS, so the due deliveries
// (ids only) come from the owner-defined `app_webhook_delivery_due`. The delivery job's singleton
// key is the delivery id, so a delivery already queued is not queued twice.
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';
import { getProducer } from '../producer.ts';

import { webhookDeliveryKey, webhookDeliverSchema } from './webhook-deliver.ts';

/** Every five minutes (Asia/Kolkata, evaluated by the worker). */
export const WEBHOOK_SWEEP_CRON = '*/5 * * * *';
export const WEBHOOK_SWEEP_LIMIT = 200;

export interface DueWebhookDelivery {
  id: string;
  workspaceId: string;
}

export interface WebhookSweepDeps {
  listDue?: (limit: number) => Promise<DueWebhookDelivery[]>;
  enqueue?: (job: { workspaceId: string; deliveryId: string }) => Promise<unknown>;
}

async function enqueueDeliver(job: { workspaceId: string; deliveryId: string }): Promise<unknown> {
  const data = webhookDeliverSchema.parse(job);
  const sender = await getProducer();
  return sender.send('webhook.deliver', data, {
    singletonKey: webhookDeliveryKey(data),
    group: { id: data.workspaceId },
  });
}

/** The job body. Exported for tests; returns how many deliveries it enqueued. */
export async function runWebhookSweep(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: WebhookSweepDeps = {},
): Promise<number> {
  const listDue =
    deps.listDue ??
    (async (limit: number): Promise<DueWebhookDelivery[]> => {
      const rows = await ctx.db.execute<{ id: string; workspace_id: string }>(
        sql`select id, workspace_id from app_webhook_delivery_due(${limit})`,
      );
      return rows.map((r) => ({ id: r.id, workspaceId: r.workspace_id }));
    });
  const enqueue = deps.enqueue ?? enqueueDeliver;
  let enqueued = 0;
  for (const due of await listDue(WEBHOOK_SWEEP_LIMIT)) {
    try {
      await enqueue({ workspaceId: due.workspaceId, deliveryId: due.id });
      enqueued += 1;
    } catch {
      ctx.log.warn({ workspaceId: due.workspaceId, deliveryId: due.id }, 'webhook enqueue failed');
    }
  }
  ctx.log.info({ enqueued }, 'webhook sweep done');
  return enqueued;
}

export const systemWebhookSweep = defineJob({
  name: 'system.webhook.sweep',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'webhook-sweep', policy: 'stately' },
  schedule: { cron: WEBHOOK_SWEEP_CRON, payload: {} },
  handler: async (ctx) => {
    await runWebhookSweep(ctx);
  },
});
