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
import { fromSubscriptionRow, normalizeGstin, toSubscriptionStatus } from '@causedeck/billing';
import { getPlan, SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '@causedeck/billing/plans';
import type { ProrationResult } from '@causedeck/billing/proration';
import { quoteChange, type BillingService, type ChangeQuote } from '@causedeck/billing/service';
import type { SeatCounts, SubscriptionSnapshot } from '@causedeck/billing/state-machine';
import { schema, type Transaction } from '@causedeck/db';
import { and, eq, notInArray } from 'drizzle-orm';

import { record } from '../audit/writer.ts';
import { invalid, notFound } from '../workspaces/errors.ts';
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
