// `webhook.deliver` (#626, #487 part 3): sends one signed change event to one customer endpoint.
// `emitWebhookEvent` (and the sweep) enqueue it with ids only. The job re-reads the delivery and its
// endpoint inside the payload's workspace, signs `<timestamp>.<body>` with the endpoint secret,
// calls `deliverWebhook` (https only, public addresses, no redirects, no response body kept) and
// records the outcome on the row:
// - a 2xx marks it `delivered` and resets the endpoint's failure streak;
// - a retryable failure (timeout, network, 5xx, 408, 425, 429) throws `RetryableError`, which rolls
//   back the `once()` claim and the attempt, and pg-boss retries with backoff; on the last attempt
//   it is recorded as `failed` instead;
// - a permanent failure (another 4xx, a redirect, a refused address) is recorded as `failed` at once;
// - every `failed` delivery counts toward `WEBHOOK_DISABLE_AFTER_FAILURES` consecutive failures, after
//   which the endpoint is switched off (`active = false`).
// Only ids, the status code and a short error code are stored or logged, never the payload or URL.
import { deliverWebhook, WebhookDeliveryError } from '@causedeck/fetch';
import { schema } from '@causedeck/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  signWebhook,
  WEBHOOK_DISABLE_AFTER_FAILURES,
  WEBHOOK_HEADERS,
} from '../../webhooks/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { once } from '../idempotency.ts';
import { DEMO_SKIP_REASON, isDemoWorkspace } from '../../shared/index.ts';

const { webhookDelivery, webhookEndpoint } = schema;

export const webhookDeliverSchema = z.object({
  workspaceId: workspaceIdSchema,
  deliveryId: z.uuid(),
});

export type WebhookDeliverPayload = z.output<typeof webhookDeliverSchema>;

/** Retries after the first attempt (pg-boss); the attempt after these is the last. */
export const WEBHOOK_RETRY_LIMIT = 5;

export type WebhookDeliverOutcome = 'delivered' | 'failed' | 'missing' | 'already_handled';

export interface WebhookDeliverDeps {
  deliver?: typeof deliverWebhook;
  now?: () => Date;
}

interface Attempt {
  status: number | null;
  error: string | null;
  ok: boolean;
  retryable: boolean;
}

function classify(status: number): Attempt {
  if (status >= 200 && status < 300) return { status, error: null, ok: true, retryable: false };
  const retryable = status >= 500 || status === 408 || status === 425 || status === 429;
  return { status, error: `http_${String(status)}`, ok: false, retryable };
}

/** Deliver one event. Exported for tests. */
export async function runWebhookDeliver(
  ctx: JobContext,
  payload: WebhookDeliverPayload,
  deps: WebhookDeliverDeps = {},
): Promise<WebhookDeliverOutcome> {
  const { workspaceId, deliveryId } = payload;
  const fields = { workspaceId, deliveryId };
  const now = deps.now ?? (() => new Date());

  const [row] = await ctx.db
    .select({
      status: webhookDelivery.status,
      endpointId: webhookDelivery.endpointId,
      eventType: webhookDelivery.eventType,
      payload: webhookDelivery.payload,
      createdAt: webhookDelivery.createdAt,
      url: webhookEndpoint.url,
      secret: webhookEndpoint.secret,
      active: webhookEndpoint.active,
    })
    .from(webhookDelivery)
    .innerJoin(
      webhookEndpoint,
      and(
        eq(webhookEndpoint.workspaceId, webhookDelivery.workspaceId),
        eq(webhookEndpoint.id, webhookDelivery.endpointId),
      ),
    )
    .where(and(eq(webhookDelivery.workspaceId, workspaceId), eq(webhookDelivery.id, deliveryId)));
  if (!row) {
    ctx.log.warn(fields, 'webhook delivery not found; nothing to send');
    return 'missing';
  }
  if (row.status !== 'pending') return 'already_handled';

  const finish = async (attempt: Attempt): Promise<WebhookDeliverOutcome> => {
    const at = now();
    await ctx.db
      .update(webhookDelivery)
      .set({
        status: attempt.ok ? 'delivered' : 'failed',
        attempts: ctx.attempt,
        lastStatus: attempt.status,
        lastError: attempt.error,
        deliveredAt: attempt.ok ? at : null,
      })
      .where(and(eq(webhookDelivery.workspaceId, workspaceId), eq(webhookDelivery.id, deliveryId)));
    if (attempt.ok) {
      await ctx.db
        .update(webhookEndpoint)
        .set({ consecutiveFailures: 0 })
        .where(
          and(eq(webhookEndpoint.workspaceId, workspaceId), eq(webhookEndpoint.id, row.endpointId)),
        );
      ctx.log.info({ ...fields, status: attempt.status }, 'webhook delivered');
      return 'delivered';
    }
    await ctx.db
      .update(webhookEndpoint)
      .set({
        consecutiveFailures: sql`${webhookEndpoint.consecutiveFailures} + 1`,
        active: sql`${webhookEndpoint.active} and ${webhookEndpoint.consecutiveFailures} + 1 < ${WEBHOOK_DISABLE_AFTER_FAILURES}`,
        disabledAt: sql`case when ${webhookEndpoint.active} and ${webhookEndpoint.consecutiveFailures} + 1 >= ${WEBHOOK_DISABLE_AFTER_FAILURES} then ${at.toISOString()}::timestamptz else ${webhookEndpoint.disabledAt} end`,
      })
      .where(
        and(eq(webhookEndpoint.workspaceId, workspaceId), eq(webhookEndpoint.id, row.endpointId)),
      );
    ctx.log.warn({ ...fields, status: attempt.status, error: attempt.error }, 'webhook failed');
    return 'failed';
  };

  if (await isDemoWorkspace(ctx.db, workspaceId)) {
    // A demo workspace sends nothing outside it (#93); the endpoint's failure streak is untouched.
    await ctx.db
      .update(webhookDelivery)
      .set({ status: 'failed', lastError: DEMO_SKIP_REASON })
      .where(and(eq(webhookDelivery.workspaceId, workspaceId), eq(webhookDelivery.id, deliveryId)));
    return 'failed';
  }

  if (!row.active) {
    // Switched off after the event was queued: nothing is sent.
    await ctx.db
      .update(webhookDelivery)
      .set({ status: 'failed', lastError: 'endpoint_disabled' })
      .where(and(eq(webhookDelivery.workspaceId, workspaceId), eq(webhookDelivery.id, deliveryId)));
    return 'failed';
  }

  const timestamp = Math.floor(now().getTime() / 1000);
  const body = JSON.stringify({
    id: deliveryId,
    type: row.eventType,
    createdAt: row.createdAt.toISOString(),
    data: row.payload,
  });
  const headers = {
    [WEBHOOK_HEADERS.event]: row.eventType,
    [WEBHOOK_HEADERS.delivery]: deliveryId,
    [WEBHOOK_HEADERS.timestamp]: String(timestamp),
    [WEBHOOK_HEADERS.signature]: signWebhook(row.secret, timestamp, body),
  };
  const lastAttempt = ctx.attempt > WEBHOOK_RETRY_LIMIT;

  const result = await once(ctx, ctx.idempotencyKey, async (): Promise<Attempt> => {
    let attempt: Attempt;
    try {
      const { status } = await (deps.deliver ?? deliverWebhook)(row.url, { body, headers });
      attempt = classify(status);
    } catch (error) {
      if (!(error instanceof WebhookDeliveryError)) throw error;
      const retryable = !['invalid_url', 'blocked_address'].includes(error.reason);
      attempt = { status: null, error: error.reason, ok: false, retryable };
    }
    if (!attempt.ok && attempt.retryable && !lastAttempt) {
      throw new RetryableError(
        'WEBHOOK_DELIVERY_RETRY',
        `delivery failed (${attempt.error ?? 'unknown'}); will retry`,
      );
    }
    return attempt;
  });
  if (result.skipped) return 'already_handled';
  return finish(result.value);
}

/** One job per delivery; also the `once()` key. */
export const webhookDeliveryKey = (p: Pick<WebhookDeliverPayload, 'deliveryId'>) => p.deliveryId;

export const webhookDeliver = defineJob({
  name: 'webhook.deliver',
  schema: webhookDeliverSchema,
  retry: { limit: WEBHOOK_RETRY_LIMIT, delaySec: 30, backoff: true, delayMaxSec: 3600 },
  singleton: { key: webhookDeliveryKey },
  idempotencyKey: webhookDeliveryKey,
  handler: async (ctx, payload) => {
    await runWebhookDeliver(ctx, payload);
  },
});
