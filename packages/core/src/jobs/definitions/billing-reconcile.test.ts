// `system.billing.reconcile` under FORCE row-level security (#206): the job has no workspace, yet
// it must find current provider-backed subscriptions in every workspace (through
// `app_billing_reconcile_targets`), compare them with the mock provider, log the differences and
// change nothing. Runs as causedeck_app in a rolled-back transaction.
import { randomUUID } from 'node:crypto';

import { createMockBillingProvider } from '@causedeck/billing/provider';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import type { Logger } from '@causedeck/observability';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import type { JobContext } from '../context.ts';
import { registry } from '../registry.ts';
import { billingReconcile, runBillingReconcile } from './billing-reconcile.ts';

const BILLING_EMAIL = 'accounts-reconcile@example.com';

type Row = Omit<typeof schema.subscription.$inferInsert, 'workspaceId'>;

async function seedSubscription(tx: Transaction, workspaceId: string, row: Row): Promise<void> {
  await inWorkspace(tx, workspaceId, async (s) => {
    await s.insert(schema.organization).values({
      id: workspaceId,
      name: 'Reconcile',
      slug: `reconcile-${workspaceId}`,
    });
    await s
      .insert(schema.subscription)
      .values({ workspaceId, billingEmail: BILLING_EMAIL, gstin: '27AAPFU0939F1ZV', ...row });
  });
}

async function snapshot(tx: Transaction, workspaceIds: readonly string[]) {
  const rows = [];
  for (const workspaceId of workspaceIds) {
    rows.push(...(await inWorkspace(tx, workspaceId, (s) => s.select().from(schema.subscription))));
  }
  return rows;
}

function reconcileContext(db: Transaction, log: { warn: unknown; info: unknown }): JobContext {
  return {
    log: log as unknown as Logger,
    db,
    workspaceId: null,
    jobName: billingReconcile.name,
    jobId: randomUUID(),
    attempt: 1,
    signal: new AbortController().signal,
    idempotencyKey: 'reconcile',
  };
}

describe('system.billing.reconcile', () => {
  it('is registered as a daily system job', () => {
    expect(registry.get('system.billing.reconcile')).toBe(billingReconcile);
    expect(billingReconcile.schedule?.cron).toBe('0 4 * * *');
    expect(billingReconcile.schema.parse({})).toEqual({});
  });

  it('logs drift across workspaces against the mock provider and mutates nothing', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const customer = await provider.createCustomer({ email: BILLING_EMAIL, name: 'Asha' });
      const created = await provider.createSubscription({
        customerId: customer.id,
        planId: 'chamber-seat-1',
        quantity: 3,
      });
      await provider.authorizeMandate(created.id);
      const remote = await provider.fetchSubscription(created.id);

      const workspaces = Array.from({ length: 5 }, (): string => randomUUID());
      const [inSync, drifted, missing, ended, local] = workspaces as [
        string,
        string,
        string,
        string,
        string,
      ];
      const base = { planId: 'chamber-seat-1', provider: 'mock', status: 'active', seats: 3 };
      await seedSubscription(tx, inSync, {
        ...base,
        providerSubscriptionId: remote.id,
        currentPeriodEnd: remote.currentEnd,
      });
      // Provider ids are unique per (provider, id), so a second row reaches the same remote
      // subscription under another provider name; its status and seats have drifted.
      await seedSubscription(tx, drifted, {
        ...base,
        provider: 'mock-drift',
        providerSubscriptionId: remote.id,
        status: 'past_due',
        seats: 4,
        currentPeriodEnd: remote.currentEnd,
      });
      await seedSubscription(tx, missing, { ...base, providerSubscriptionId: 'sub_mock_gone' });
      await seedSubscription(tx, ended, {
        ...base,
        status: 'cancelled',
        providerSubscriptionId: 'sub_mock_ended',
      });
      await seedSubscription(tx, local, { ...base, providerSubscriptionId: null });
      const before = await snapshot(tx, workspaces);

      const warn = vi.fn();
      const info = vi.fn();
      const fetch = vi.spyOn(provider, 'fetchSubscription');
      const mutators = (
        [
          'createCustomer',
          'createSubscription',
          'updateSubscriptionQuantity',
          'cancelSubscription',
          'pause',
          'resume',
          'createMandateLink',
        ] as const
      ).map((m) => vi.spyOn(provider, m));

      // No workspace pinned, as the worker runs system jobs.
      const report = await runBillingReconcile(reconcileContext(tx, { warn, info }), provider);

      // Only the three current provider-backed subscriptions are checked.
      expect(report.checked).toBe(3);
      expect(fetch).toHaveBeenCalledTimes(3);
      for (const spy of mutators) expect(spy).not.toHaveBeenCalled();

      const logged = warn.mock.calls.map(([fields]) => fields as Record<string, unknown>);
      expect(logged.map((f) => [f.workspaceId, f.field, f.local, f.remote]).sort()).toEqual(
        [
          [drifted, 'status', 'past_due', 'active'],
          [drifted, 'seats', 4, 3],
          [missing, 'missing_at_provider', 'active', null],
        ].sort(),
      );
      for (const call of warn.mock.calls) expect(call[1]).toBe('billing reconcile discrepancy');
      expect(info).toHaveBeenCalledWith(
        { checked: 3, discrepancies: 3 },
        'billing reconcile complete',
      );
      const output = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
      expect(output).not.toContain(BILLING_EMAIL);
      expect(output).not.toContain('27AAPFU0939F1ZV');

      // Log only: every row is exactly as it was.
      expect(await snapshot(tx, workspaces)).toEqual(before);
    });
  });

  it('lists targets as ids only and only to the app role', async () => {
    await withTestDb(async (tx) => {
      const columns = await tx.execute<{ name: string }>(
        sql`select a.attname as name from pg_proc p, unnest(p.proargnames) with ordinality a(attname, n)
            where p.proname = 'app_billing_reconcile_targets' order by a.n`,
      );
      expect(columns.map((c) => c.name)).toEqual(['workspace_id', 'subscription_id']);
      const [grants] = await tx.execute<{ app: boolean; definer: boolean }>(
        sql`select has_function_privilege('causedeck_app', 'app_billing_reconcile_targets()', 'execute') as app,
                   p.prosecdef as definer
            from pg_proc p where p.proname = 'app_billing_reconcile_targets'`,
      );
      expect(grants).toEqual({ app: true, definer: true });
    });
  });
});
