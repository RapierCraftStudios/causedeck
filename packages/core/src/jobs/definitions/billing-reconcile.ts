// `system.billing.reconcile` (#28 part 7, #206): daily comparison of every current subscription
// with the billing provider. It only logs what differs and never mutates local state or the
// provider: webhooks (#204) stay the one path that changes a subscription. `subscription` is under
// FORCE row-level security and this job has no workspace, so it lists its targets (ids only)
// through the owner-defined `app_billing_reconcile_targets` function (0007_billing_reconcile) and
// reads each row inside its own `withWorkspace` scope. Workspace-less jobs are `system.*` by rule.
import type { SubscriptionStatus } from '@causedeck/billing';
import { createBillingProvider, type BillingProvider } from '@causedeck/billing/provider';
import {
  reconcileSubscriptions,
  type ReconcileReport,
  type ReconcileSubscriptionInput,
} from '@causedeck/billing/reconcile';
import { serverEnv } from '@causedeck/config/env';
import { schema, withWorkspace } from '@causedeck/db';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

/** Read the stored subscriptions to reconcile: only the compared fields, never contact data. */
async function loadSubscriptions(db: JobContext['db']): Promise<ReconcileSubscriptionInput[]> {
  const targets = await db.execute<{ workspace_id: string; subscription_id: string }>(
    sql`select workspace_id::text, subscription_id::text from app_billing_reconcile_targets()`,
  );
  const rows: ReconcileSubscriptionInput[] = [];
  for (const target of targets) {
    const [row] = await withWorkspace(db, { workspaceId: target.workspace_id }, (tx) =>
      tx
        .select({
          workspaceId: schema.subscription.workspaceId,
          id: schema.subscription.id,
          status: schema.subscription.status,
          seats: schema.subscription.seats,
          currentPeriodEnd: schema.subscription.currentPeriodEnd,
          cancelAtPeriodEnd: schema.subscription.cancelAtPeriodEnd,
          providerSubscriptionId: schema.subscription.providerSubscriptionId,
        })
        .from(schema.subscription)
        .where(eq(schema.subscription.id, target.subscription_id)),
    );
    if (row) rows.push({ ...row, status: row.status as SubscriptionStatus });
  }
  return rows;
}

/** Reconcile against `provider` and log each discrepancy. Exported for tests. */
export async function runBillingReconcile(
  ctx: JobContext,
  provider: Pick<BillingProvider, 'fetchSubscription'>,
): Promise<ReconcileReport> {
  const subscriptions = await loadSubscriptions(ctx.db);
  const report = await reconcileSubscriptions({ subscriptions, provider });
  for (const d of report.discrepancies) {
    ctx.log.warn(
      {
        workspaceId: d.workspaceId,
        subscriptionId: d.subscriptionId,
        providerSubscriptionId: d.providerSubscriptionId,
        field: d.field,
        local: d.local,
        remote: d.remote,
      },
      'billing reconcile discrepancy',
    );
  }
  ctx.log.info(
    { checked: report.checked, discrepancies: report.discrepancies.length },
    'billing reconcile complete',
  );
  return report;
}

export const billingReconcile = defineJob({
  name: 'system.billing.reconcile',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'billing-reconcile', policy: 'stately' },
  // 04:00 IST, after the 03:30 retention sweep.
  schedule: { cron: '0 4 * * *', payload: {} },
  handler: async (ctx) => {
    await runBillingReconcile(ctx, createBillingProvider(serverEnv()));
  },
});
