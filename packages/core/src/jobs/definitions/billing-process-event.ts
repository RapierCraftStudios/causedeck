// `billing.process-event` (#28 part 5, #204): applies one stored Razorpay webhook event to the
// workspace's subscription. The webhook route (`apps/api/src/routes/webhooks/razorpay.ts`) verifies
// the signature, resolves the workspace from the stored provider subscription id, stores the
// minimised event in `billing_event` and enqueues this job with ids only. Exactly once: the
// `billing_event` row is locked and `processed_at` set in the same transaction as the update, so a
// redelivered or retried job changes nothing. An event the state machine rejects is marked
// processed and logged, never retried (a retry cannot make it legal). The route enqueues inside
// the transaction that stores the event, so a job that runs before that commit cannot see its row
// yet: it throws `RetryableError` and pg-boss retries it with backoff.
import {
  applyProviderEvent,
  fromSubscriptionRow,
  IllegalTransitionError,
  toSubscriptionStatus,
} from '@causedeck/billing';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '@causedeck/billing/plans';
import type { RazorpayWebhookEvent } from '@causedeck/billing/provider';
import { schema, withWorkspace } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { invalidateEntitlements } from '../../billing/entitlements.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';

const { billingEvent, subscription } = schema;

export const billingProcessEventSchema = z.object({
  workspaceId: workspaceIdSchema,
  providerEventId: z.string().min(1).max(255),
});

export type BillingProcessEventPayload = z.output<typeof billingProcessEventSchema>;

export type BillingProcessEventOutcome =
  'applied' | 'unchanged' | 'already_processed' | 'unknown_subscription' | 'illegal_transition';

const isStatus = (status: string): status is SubscriptionStatus =>
  (SUBSCRIPTION_STATUSES as readonly string[]).includes(status);

/** Apply the stored event once. Exported for tests; logs carry ids only, never the payload. */
export async function runBillingProcessEvent(
  ctx: Pick<JobContext, 'db' | 'log'>,
  { workspaceId, providerEventId }: BillingProcessEventPayload,
  { now = () => new Date() }: { now?: () => Date } = {},
): Promise<BillingProcessEventOutcome> {
  const fields = { workspaceId, providerEventId };
  const outcome = await withWorkspace(ctx.db, { workspaceId }, async (tx) => {
    const [event] = await tx
      .select()
      .from(billingEvent)
      .where(
        and(
          eq(billingEvent.providerEventId, providerEventId),
          eq(billingEvent.workspaceId, workspaceId),
        ),
      )
      .for('update');
    if (!event)
      throw new RetryableError('BILLING_EVENT_NOT_FOUND', 'billing event not visible yet');
    if (event.processedAt !== null) return 'already_processed';

    const at = now();
    const markProcessed = () =>
      tx
        .update(billingEvent)
        .set({ processedAt: at })
        .where(eq(billingEvent.providerEventId, providerEventId));

    const body = event.payload as RazorpayWebhookEvent | null;
    const providerSubscriptionId = body?.payload.subscription?.entity.id;
    const [row] = providerSubscriptionId
      ? await tx
          .select()
          .from(subscription)
          .where(
            and(
              eq(subscription.workspaceId, workspaceId),
              eq(subscription.providerSubscriptionId, providerSubscriptionId),
            ),
          )
          .for('update')
      : [];
    if (!body || !row || !isStatus(row.status)) {
      await markProcessed();
      return 'unknown_subscription';
    }

    const before = fromSubscriptionRow({ ...row, status: row.status });
    let next;
    try {
      next = applyProviderEvent(before, body, at);
    } catch (error) {
      if (!(error instanceof IllegalTransitionError)) throw error;
      ctx.log.warn(
        { ...fields, type: event.type, from: error.from, event: error.event },
        'billing event rejected by the state machine',
      );
      await markProcessed();
      return 'illegal_transition';
    }

    if (next !== before) {
      await tx
        .update(subscription)
        .set({
          status: toSubscriptionStatus(next.state),
          planId: next.planId,
          seats: next.seats,
          clerkSeats: next.clerkSeats,
          currentPeriodStart: next.currentPeriodStart,
          currentPeriodEnd: next.currentPeriodEnd,
          graceUntil: next.graceUntil,
          cancelAtPeriodEnd: next.cancelAtPeriodEnd,
        })
        .where(eq(subscription.id, row.id));
    }
    await markProcessed();
    return next === before ? 'unchanged' : 'applied';
  });

  if (outcome === 'applied') invalidateEntitlements(workspaceId);
  if (outcome === 'unknown_subscription') {
    ctx.log.warn({ ...fields, outcome }, 'billing event not applied');
  } else {
    ctx.log.info({ ...fields, outcome }, 'billing event processed');
  }
  return outcome;
}

export const billingProcessEvent = defineJob({
  name: 'billing.process-event',
  schema: billingProcessEventSchema,
  singleton: { key: (payload) => payload.providerEventId },
  idempotencyKey: (payload) => payload.providerEventId,
  handler: async (ctx, payload) => {
    await runBillingProcessEvent(ctx, payload);
  },
});
