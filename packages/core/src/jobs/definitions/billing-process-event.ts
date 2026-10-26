// `billing.process-event` (#28 part 5, #204): applies one stored Razorpay webhook event to the
// workspace's subscription. The webhook route (`apps/api/src/routes/webhooks/razorpay.ts`) verifies
// the signature, resolves the workspace from the stored provider subscription id, stores the
// minimised event in `billing_event` and enqueues this job with ids only. Exactly once: the
// `billing_event` row is locked and `processed_at` set in the same transaction as the update, so a
// redelivered or retried job changes nothing. An event the state machine rejects is marked
// processed and logged, never retried (a retry cannot make it legal). The route enqueues inside
// the transaction that stores the event, so a job that runs before that commit cannot see its row
// yet: it throws `RetryableError` and pg-boss retries it with backoff.
//
// Invoice on payment (#255): an accepted `subscription.charged` with a captured payment issues the
// SaaS invoice (`invoiceOnPayment`) in the same transaction, so the invoice and `processed_at`
// commit together and one payment never gets two invoices (also `saas_invoice_payment_uq`). An
// invoice failure (e.g. the supplier is not configured in production) rolls the event back and the
// job is retried. After commit, `billing.invoice-render` is enqueued for the new invoice.
import {
  applyProviderEvent,
  fromSubscriptionRow,
  IllegalTransitionError,
  toSubscriptionStatus,
  type SubscriptionState,
} from '@causedeck/billing';
import { supplierFromEnv, type SupplierConfig } from '@causedeck/billing/config/supplier';
import { invoiceOnPayment } from '@causedeck/billing/invoice/on-payment';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '@causedeck/billing/plans';
import type { RazorpayWebhookEvent } from '@causedeck/billing/provider';
import { schema, withWorkspace } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { createInvoiceStore, invalidateEntitlements } from '../../billing/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import {
  enqueueInvoiceRender,
  type BillingInvoiceRenderPayload,
} from './billing-invoice-render.ts';

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

const inDunning = (state: SubscriptionState) => state === 'past_due' || state === 'grace';

/**
 * The dunning columns after a move (#205): entering past_due/grace starts an episode, leaving them
 * ends it, and moving within them keeps it.
 */
export function dunningAfter(
  from: SubscriptionState,
  to: SubscriptionState,
  current: { dunningStartedAt: Date | null; dunningAttempts: number },
  at: Date,
): { dunningStartedAt: Date | null; dunningAttempts: number } {
  if (!inDunning(to)) return { dunningStartedAt: null, dunningAttempts: 0 };
  if (!inDunning(from) || current.dunningStartedAt === null) {
    return { dunningStartedAt: at, dunningAttempts: 0 };
  }
  return { dunningStartedAt: current.dunningStartedAt, dunningAttempts: current.dunningAttempts };
}

export interface BillingProcessEventDeps {
  now?: () => Date;
  /** Supplier for invoices; defaults to `supplierFromEnv()` (refuses in production when unset). */
  supplier?: () => SupplierConfig;
  /** Defaults to sending `billing.invoice-render`. */
  enqueueRender?: (job: BillingInvoiceRenderPayload) => Promise<unknown>;
}

/** Apply the stored event once. Exported for tests; logs carry ids only, never the payload. */
export async function runBillingProcessEvent(
  ctx: Pick<JobContext, 'db' | 'log'>,
  { workspaceId, providerEventId }: BillingProcessEventPayload,
  {
    now = () => new Date(),
    supplier = () => supplierFromEnv(),
    enqueueRender = enqueueInvoiceRender,
  }: BillingProcessEventDeps = {},
): Promise<BillingProcessEventOutcome> {
  const fields = { workspaceId, providerEventId };
  // Set inside the transaction; read after it commits.
  let issuedInvoiceId = null as string | null;
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
          ...dunningAfter(before.state, next.state, row, at),
        })
        .where(eq(subscription.id, row.id));
    }
    const invoice = await invoiceOnPayment(
      { store: createInvoiceStore(tx, workspaceId), supplier, now: () => at },
      {
        event: body,
        subscriptionId: row.id,
        planId: next.planId,
        seats: next.seats,
        clerkSeats: next.clerkSeats,
        periodStart: next.currentPeriodStart ?? at,
        periodEnd: next.currentPeriodEnd ?? next.currentPeriodStart ?? at,
      },
    );
    if (invoice?.created) issuedInvoiceId = invoice.invoiceId;
    await markProcessed();
    return next === before ? 'unchanged' : 'applied';
  });

  if (outcome === 'applied') invalidateEntitlements(workspaceId);
  if (issuedInvoiceId !== null) {
    ctx.log.info({ ...fields, invoiceId: issuedInvoiceId }, 'billing invoice issued');
    await enqueueRender({ workspaceId, invoiceId: issuedInvoiceId });
  }
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
