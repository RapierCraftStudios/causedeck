// Owner billing actions on the database (#257): change seats or plan, cancel at period end, resume
// (a paused subscription, or one set to cancel) and capture the GSTIN. `@causedeck/billing` is pure,
// so this adapter loads the live subscription row for update on the caller's workspace-scoped
// transaction, runs the billing service against the provider, persists the returned snapshot (the
// same columns the webhook job writes, `billing-process-event.ts`) and records an audit event.
// Authorization (`billing.manage`) is the caller's job (`workspaceAction`).
//
// The provider call runs inside the transaction: if the row update fails afterwards, the daily
// reconcile job (#206) reports the drift. A seat decrease is scheduled at the provider and lands
// on the next `subscription.charged` (the row has no pending-seats column).
//
// The GSTIN only changes `subscription.gstin`: invoices copy the recipient GSTIN when they are
// issued (`createInvoiceStore().loadRecipient`), and issued invoices are immutable (trigger in
// migration 0017), so a new GSTIN applies to future invoices only.
import {
  applyProviderEvent,
  fromSubscriptionRow,
  normalizeGstin,
  toSubscriptionStatus,
} from '@causedeck/billing';
import { getPlan, SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '@causedeck/billing/plans';
import type { RazorpayWebhookEvent } from '@causedeck/billing/provider';
import type { ProrationResult } from '@causedeck/billing/proration';
import { quoteChange, type BillingService, type ChangeQuote } from '@causedeck/billing/service';
import type { SeatCounts, SubscriptionSnapshot } from '@causedeck/billing/state-machine';
import { schema, type Transaction } from '@causedeck/db';
import { and, eq, notInArray } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { invalid, notFound } from '../shared/errors.ts';
import { assertNotDemoWorkspace } from '../shared/demo-guard.ts';
import { invalidateEntitlements } from './entitlements.ts';

const { subscription } = schema;

export type SubscriptionRow = typeof subscription.$inferSelect;

/** Who acts, on which workspace. `tx` must be scoped to `workspaceId` (`withWorkspace`). */
export interface BillingActionContext {
  tx: Transaction;
  workspaceId: string;
  actorUserId: string;
  /** The billing service for this row (the web app adopts the row into the mock provider first). */
  service: (row: SubscriptionRow) => Promise<BillingService> | BillingService;
  now?: () => Date;
}

export type SubscriptionChange =
  | ({ kind: 'seats' } & SeatCounts)
  | ({ kind: 'plan'; planId: string } & SeatCounts)
  | { kind: 'cancel' }
  | { kind: 'resume' };

export interface SubscriptionChangeResult {
  subscription: SubscriptionSnapshot;
  /** The prorated amount due now (ex-GST), collected by invoicing; null when nothing is due. */
  charge: ProrationResult | null;
}

const LIVE_EXCLUDED = ['cancelled', 'expired'] as const;

const isStatus = (status: string): status is SubscriptionStatus =>
  (SUBSCRIPTION_STATUSES as readonly string[]).includes(status);

/** The workspace's live (not cancelled or expired) subscription, locked for update. */
async function lockLiveSubscription(tx: Transaction, workspaceId: string) {
  const [row] = await tx
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.workspaceId, workspaceId),
        notInArray(subscription.status, [...LIVE_EXCLUDED]),
      ),
    )
    .for('update');
  if (!row || !isStatus(row.status)) throw notFound('No active subscription');
  return { row, snapshot: fromSubscriptionRow({ ...row, status: row.status }) };
}

/** Apply one owner change to the live subscription and persist it. */
export async function changeSubscription(
  ctx: BillingActionContext,
  change: SubscriptionChange,
): Promise<SubscriptionChangeResult> {
  const { tx, workspaceId } = ctx;
  // A demo workspace has no billing (#93): nothing reaches the payment provider.
  await assertNotDemoWorkspace(tx, workspaceId);
  const { row, snapshot } = await lockLiveSubscription(tx, workspaceId);
  const service = await ctx.service(row);
  const result = await (() => {
    switch (change.kind) {
      case 'seats':
        return service.changeSeats(snapshot, {
          seats: change.seats,
          clerkSeats: change.clerkSeats,
        });
      case 'plan':
        return service.changePlan(snapshot, {
          planId: change.planId,
          seats: change.seats,
          clerkSeats: change.clerkSeats,
        });
      case 'cancel':
        return service.cancel(snapshot, { atPeriodEnd: true });
      case 'resume':
        return snapshot.state === 'paused'
          ? service.resume(snapshot)
          : service.withdrawCancellation(snapshot);
    }
  })();
  const next = result.subscription;
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
  await record(
    { db: tx, workspaceId, actor: { userId: ctx.actorUserId, kind: 'user' } },
    {
      action: 'billing.subscription_changed',
      target: { kind: 'subscription', id: row.id },
      metadata: {
        change: change.kind,
        planId: next.planId,
        seats: next.seats,
        clerkSeats: next.clerkSeats,
        cancelAtPeriodEnd: next.cancelAtPeriodEnd,
        chargePaise: result.charge?.amountPaise ?? 0,
      },
    },
  );
  invalidateEntitlements(workspaceId);
  return { subscription: next, charge: result.charge };
}

export function changeSubscriptionSeats(ctx: BillingActionContext, seats: SeatCounts) {
  return changeSubscription(ctx, { kind: 'seats', ...seats });
}

export function changeSubscriptionPlan(
  ctx: BillingActionContext,
  input: { planId: string } & SeatCounts,
) {
  return changeSubscription(ctx, { kind: 'plan', ...input });
}

export function cancelSubscriptionAtPeriodEnd(ctx: BillingActionContext) {
  return changeSubscription(ctx, { kind: 'cancel' });
}

/** Resume a paused subscription, or keep one that was set to cancel at period end. */
export function resumeSubscription(ctx: BillingActionContext) {
  return changeSubscription(ctx, { kind: 'resume' });
}

/** The pre-confirmation summary for a plan and/or seat change on the live subscription. */
export async function quoteSubscriptionChange(
  tx: Transaction,
  workspaceId: string,
  target: { planId: string } & SeatCounts,
  now: Date = new Date(),
): Promise<ChangeQuote> {
  const { row } = await lockLiveSubscription(tx, workspaceId);
  const currentPlan = getPlan(row.planId);
  const targetPlan = getPlan(target.planId);
  if (!currentPlan) throw invalid(`Unknown plan ${row.planId}`);
  if (!targetPlan?.active || targetPlan.pricePaise === 0) {
    throw invalid(`Unknown or inactive plan ${target.planId}`);
  }
  return quoteChange({
    current: { plan: currentPlan, counts: { seats: row.seats, clerkSeats: row.clerkSeats } },
    target: { plan: targetPlan, counts: { seats: target.seats, clerkSeats: target.clerkSeats } },
    periodStart: row.currentPeriodStart,
    periodEnd: row.currentPeriodEnd,
    at: now,
  });
}

/**
 * Save the workspace's GSTIN (`normalizeGstin`: trimmed, uppercased, format and check digit;
 * empty clears it). Throws `InvalidGstinError` for an invalid one. Changes `subscription.gstin`
 * only, so it affects future invoices and never an issued one.
 */
export async function setSubscriptionGstin(
  ctx: Pick<BillingActionContext, 'tx' | 'workspaceId' | 'actorUserId'>,
  raw: string | null,
): Promise<string | null> {
  const gstin = normalizeGstin(raw);
  const { row } = await lockLiveSubscription(ctx.tx, ctx.workspaceId);
  await ctx.tx.update(subscription).set({ gstin }).where(eq(subscription.id, row.id));
  await record(
    { db: ctx.tx, workspaceId: ctx.workspaceId, actor: { userId: ctx.actorUserId, kind: 'user' } },
    {
      action: 'billing.gstin_updated',
      target: { kind: 'subscription', id: row.id },
      metadata: { cleared: gstin === null },
    },
  );
  return gstin;
}

/** The mandate step the provider completes on its own (the mock; Razorpay uses the hosted link). */
export type CompleteMandate = (
  providerSubscriptionId: string,
) => Promise<RazorpayWebhookEvent | null>;

export interface StartCheckoutContext {
  tx: Transaction;
  workspaceId: string;
  actorUserId: string;
  /** The billing contact the provider customer is created with (the owner's email). */
  billingEmail: string;
  customerName?: string;
  /** The `subscription.provider` value (`mock` or `razorpay`). */
  providerName: string;
  service: () => Promise<BillingService> | BillingService;
  /** The mock provider authorises the UPI Autopay mandate at once; a real provider leaves it null. */
  completeMandate?: CompleteMandate | null;
  now?: () => Date;
}

export interface CheckoutResult {
  subscription: SubscriptionSnapshot;
  /** The hosted authorisation link to send the owner to; null once the mandate is complete. */
  mandateUrl: string | null;
  /** Whether the subscription is already active (the mock provider completes the mandate). */
  activated: boolean;
}

/** Write a snapshot onto its row (the columns the webhook job writes). */
async function persistSnapshot(
  tx: Transaction,
  row: SubscriptionRow,
  next: SubscriptionSnapshot,
): Promise<void> {
  const inDunning = next.state === 'past_due' || next.state === 'grace';
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
      ...(inDunning ? {} : { dunningStartedAt: null, dunningAttempts: 0 }),
    })
    .where(eq(subscription.id, row.id));
}

/**
 * Upgrade a Junior workspace (no paid subscription) to a paid plan (#1072): creates the provider
 * customer and subscription through the billing service, stores the row as `trialing` (pending
 * mandate) and, when the provider completes the mandate itself (the mock), applies the activation
 * so the owner returns to a billing page on the new plan. A row left pending by an abandoned
 * checkout is restarted. Authorization (`billing.manage`) is the caller's job.
 */
export async function startSubscriptionCheckout(
  ctx: StartCheckoutContext,
  input: { planId: string } & SeatCounts,
): Promise<CheckoutResult> {
  const { tx, workspaceId } = ctx;
  const now = ctx.now ?? (() => new Date());
  await assertNotDemoWorkspace(tx, workspaceId);
  const [existing] = await tx
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.workspaceId, workspaceId),
        notInArray(subscription.status, [...LIVE_EXCLUDED]),
      ),
    )
    .for('update');
  if (existing && existing.planId !== 'junior' && existing.status !== 'trialing') {
    throw invalid('The workspace already has a paid subscription');
  }
  const service = await ctx.service();
  const started = await service.startSubscription({
    planId: input.planId,
    seats: input.seats,
    clerkSeats: input.clerkSeats,
    billingEmail: ctx.billingEmail,
    ...(ctx.customerName === undefined ? {} : { customerName: ctx.customerName }),
    notes: { workspaceId },
  });
  const created = started.subscription;
  const values = {
    planId: created.planId,
    status: toSubscriptionStatus(created.state),
    seats: created.seats,
    clerkSeats: created.clerkSeats,
    provider: ctx.providerName,
    providerSubscriptionId: created.providerSubscriptionId,
    providerCustomerId: created.providerCustomerId,
    currentPeriodStart: created.currentPeriodStart,
    currentPeriodEnd: created.currentPeriodEnd,
    graceUntil: null,
    cancelAtPeriodEnd: false,
    billingEmail: ctx.billingEmail,
  };
  const [row] = existing
    ? await tx.update(subscription).set(values).where(eq(subscription.id, existing.id)).returning()
    : await tx
        .insert(subscription)
        .values({ workspaceId, ...values })
        .returning();
  if (!row) throw notFound('Subscription was not saved');

  let snapshot: SubscriptionSnapshot = created;
  let activated = false;
  const event =
    ctx.completeMandate && created.providerSubscriptionId
      ? await ctx.completeMandate(created.providerSubscriptionId)
      : null;
  if (event) {
    snapshot = applyProviderEvent(created, event, now());
    await persistSnapshot(tx, row, snapshot);
    activated = snapshot.state === 'active';
  }
  await record(
    { db: tx, workspaceId, actor: { userId: ctx.actorUserId, kind: 'user' } },
    {
      action: 'billing.checkout_started',
      target: { kind: 'subscription', id: row.id },
      metadata: {
        planId: created.planId,
        seats: created.seats,
        clerkSeats: created.clerkSeats,
        provider: ctx.providerName,
        activated,
      },
    },
  );
  invalidateEntitlements(workspaceId);
  return { subscription: snapshot, mandateUrl: activated ? null : started.mandateUrl, activated };
}

export interface UpdatePaymentMethodContext extends BillingActionContext {
  completeMandate?: CompleteMandate | null;
}

export interface UpdatePaymentMethodResult {
  /** The hosted link to re-authorise the mandate; null once the provider completed it. */
  mandateUrl: string | null;
  completed: boolean;
  subscription: SubscriptionSnapshot;
}

/**
 * Restart the UPI Autopay mandate of the live subscription (#1072). With a provider that
 * completes the mandate itself (the mock) the new mandate is active at once and a failed payment
 * is charged, so the page shows the recovered state; otherwise the owner is sent to the link and
 * the webhook reports the result.
 */
export async function updateSubscriptionPaymentMethod(
  ctx: UpdatePaymentMethodContext,
): Promise<UpdatePaymentMethodResult> {
  const { tx, workspaceId } = ctx;
  const now = ctx.now ?? (() => new Date());
  await assertNotDemoWorkspace(tx, workspaceId);
  const { row, snapshot } = await lockLiveSubscription(tx, workspaceId);
  const service = await ctx.service(row);
  const { mandateUrl } = await service.updatePaymentMethod(snapshot);
  const event =
    ctx.completeMandate && row.providerSubscriptionId
      ? await ctx.completeMandate(row.providerSubscriptionId)
      : null;
  let next = snapshot;
  if (event) {
    next = applyProviderEvent(snapshot, event, now());
    if (next !== snapshot) await persistSnapshot(tx, row, next);
  }
  const completed = ctx.completeMandate != null;
  await record(
    { db: tx, workspaceId, actor: { userId: ctx.actorUserId, kind: 'user' } },
    {
      action: 'billing.payment_method_updated',
      target: { kind: 'subscription', id: row.id },
      metadata: { completed, state: next.state },
    },
  );
  invalidateEntitlements(workspaceId);
  return { mandateUrl: completed ? null : mandateUrl, completed, subscription: next };
}
