// Subscription reconciliation (#28 part 7, #206). The daily `system.billing.reconcile` job (in
// `@causedeck/core/jobs`) feeds the stored subscriptions through `reconcileSubscriptions`, which
// compares each with `provider.fetchSubscription` and reports the differences. It never mutates:
// the only provider call is `fetchSubscription`, and the job only logs what comes back. Webhooks
// (#204) remain the one path that changes local state.
//
// Server-only (it reaches the provider), so it is a subpath export, not part of the barrel.
import type { SubscriptionStatus } from './plans';
import {
  BillingProviderError,
  type BillingProvider,
  type ProviderSubscriptionStatus,
} from './provider/types';

/** The `subscription.status` a provider status should be stored as. */
export const PROVIDER_TO_LOCAL_STATUS: Readonly<
  Record<ProviderSubscriptionStatus, SubscriptionStatus>
> = Object.freeze({
  created: 'trialing',
  authenticated: 'trialing',
  active: 'active',
  pending: 'past_due',
  halted: 'past_due',
  paused: 'paused',
  cancelled: 'cancelled',
  completed: 'cancelled',
  expired: 'expired',
});

/** The stored fields reconciliation reads: never `billing_email`, `gstin` or other contact data. */
export interface ReconcileSubscriptionInput {
  workspaceId: string;
  id: string;
  status: SubscriptionStatus;
  seats: number;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  providerSubscriptionId: string | null;
}

export type ReconcileField =
  | 'missing_at_provider'
  | 'fetch_failed'
  | 'status'
  | 'seats'
  | 'current_period_end'
  | 'cancel_at_period_end';

export type ReconcileValue = string | number | boolean | null;

export interface ReconcileDiscrepancy {
  workspaceId: string;
  subscriptionId: string;
  providerSubscriptionId: string;
  field: ReconcileField;
  local: ReconcileValue;
  remote: ReconcileValue;
}

export interface ReconcileReport {
  /** Subscriptions compared with the provider (rows without a provider id are skipped). */
  checked: number;
  discrepancies: ReconcileDiscrepancy[];
}

export interface ReconcileInput {
  subscriptions: readonly ReconcileSubscriptionInput[];
  /** Only `fetchSubscription` is called. */
  provider: Pick<BillingProvider, 'fetchSubscription'>;
}

const toSecond = (date: Date): number => Math.floor(date.getTime() / 1000);

/**
 * Compare each stored subscription with the provider. A provider failure for one subscription is
 * reported (`missing_at_provider` for `not_found`, else `fetch_failed` with the error code only)
 * and never stops the run.
 */
export async function reconcileSubscriptions({
  subscriptions,
  provider,
}: ReconcileInput): Promise<ReconcileReport> {
  const discrepancies: ReconcileDiscrepancy[] = [];
  let checked = 0;

  for (const local of subscriptions) {
    const providerSubscriptionId = local.providerSubscriptionId;
    if (providerSubscriptionId === null) continue;
    checked += 1;
    const report = (field: ReconcileField, localValue: ReconcileValue, remote: ReconcileValue) =>
      discrepancies.push({
        workspaceId: local.workspaceId,
        subscriptionId: local.id,
        providerSubscriptionId,
        field,
        local: localValue,
        remote,
      });

    let remote;
    try {
      remote = await provider.fetchSubscription(providerSubscriptionId);
    } catch (error) {
      if (error instanceof BillingProviderError && error.code === 'not_found') {
        report('missing_at_provider', local.status, null);
      } else {
        report(
          'fetch_failed',
          local.status,
          error instanceof BillingProviderError ? error.code : 'error',
        );
      }
      continue;
    }

    const expected = PROVIDER_TO_LOCAL_STATUS[remote.status];
    if (local.status !== expected) report('status', local.status, remote.status);
    if (local.seats !== remote.quantity) report('seats', local.seats, remote.quantity);
    if (
      local.currentPeriodEnd !== null &&
      remote.currentEnd !== null &&
      toSecond(local.currentPeriodEnd) !== toSecond(remote.currentEnd)
    ) {
      report(
        'current_period_end',
        local.currentPeriodEnd.toISOString(),
        remote.currentEnd.toISOString(),
      );
    }
    if (local.cancelAtPeriodEnd !== remote.cancelAtCycleEnd) {
      report('cancel_at_period_end', local.cancelAtPeriodEnd, remote.cancelAtCycleEnd);
    }
  }

  return { checked, discrepancies };
}
