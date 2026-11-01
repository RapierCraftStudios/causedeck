// Junior upgrade checkout and payment-method update against a real Postgres (#1072), on the mock
// billing provider: the row is created pending, the mock completes the UPI Autopay mandate, a
// failed payment is recovered, and a demo workspace never reaches the provider. Every test runs in
// a rolled-back transaction.
import { randomUUID } from 'node:crypto';

import { createMockBillingProvider, MOCK_EPOCH } from '@causedeck/billing/provider';
import { createBillingService } from '@causedeck/billing/service';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createWorkspace } from '../../workspaces/index.ts';
import {
  startSubscriptionCheckout,
  updateSubscriptionPaymentMethod,
  type StartCheckoutContext,
} from '../index.ts';

const AT = new Date(MOCK_EPOCH.getTime() + 10 * 86_400_000);

async function setup(tx: Transaction, options: { demo?: boolean } = {}) {
  await seedPlans(tx);
  const [user] = await tx
    .insert(schema.user)
    .values({ name: 'Owner', email: `${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!user) throw new Error('user insert failed');
  const workspace = await createWorkspace(tx, {
    userId: user.id,
    input: { name: `Chambers ${randomUUID().slice(0, 8)}` },
  });
  const workspaceId = workspace.id;
  if (options.demo) {
    await inWorkspace(tx, workspaceId, (s) =>
      s
        .update(schema.organization)
        .set({ isDemo: true })
        .where(eq(schema.organization.id, workspaceId)),
    );
  }
  const provider = createMockBillingProvider({ now: () => AT });
  const service = createBillingService({ provider, now: () => AT });
  const flow = {
    providerName: 'mock',
    service: () => service,
    completeMandate: (id: string) => provider.confirmPaymentMethod(id),
  };
  const checkout = (
    input: { planId: string; seats: number },
    override: Partial<StartCheckoutContext> = {},
  ) =>
    inWorkspace(tx, workspaceId, (s) =>
      startSubscriptionCheckout(
        {
          tx: s,
          workspaceId,
          actorUserId: user.id,
          billingEmail: 'owner@example.test',
          now: () => AT,
          ...flow,
          ...override,
        },
        { ...input, clerkSeats: 0 },
      ),
    );
  const updateMethod = (completeMandate = flow.completeMandate) =>
    inWorkspace(tx, workspaceId, (s) =>
      updateSubscriptionPaymentMethod({
        tx: s,
        workspaceId,
        actorUserId: user.id,
        now: () => AT,
        service: () => service,
        completeMandate,
      }),
    );
  const row = () =>
    inWorkspace(tx, workspaceId, async (s) => {
      const [found] = await s
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.workspaceId, workspaceId));
      return found;
    });
  const audits = (action: string) =>
    inWorkspace(tx, workspaceId, (s) =>
      s
        .select()
        .from(schema.auditEvent)
        .where(
          and(eq(schema.auditEvent.workspaceId, workspaceId), eq(schema.auditEvent.action, action)),
        ),
    );
  return { workspaceId, provider, checkout, updateMethod, row, audits };
}

describe('startSubscriptionCheckout', () => {
  it('creates the subscription through the mock provider and activates it', async () => {
    await withTestDb(async (tx) => {
      const { checkout, row, audits } = await setup(tx);
      const result = await checkout({ planId: 'advocate-monthly-1', seats: 1 });
      expect(result).toMatchObject({ activated: true, mandateUrl: null });
      expect(await row()).toMatchObject({
        planId: 'advocate-monthly-1',
        status: 'active',
        provider: 'mock',
        billingEmail: 'owner@example.test',
      });
      expect((await row())?.providerSubscriptionId).toMatch(/^sub_mock_/);
      expect(await audits('billing.checkout_started')).toHaveLength(1);
    });
  });

  it('stays pending with the hosted link when the provider does not complete the mandate', async () => {
    await withTestDb(async (tx) => {
      const { checkout, row } = await setup(tx);
      const result = await checkout(
        { planId: 'advocate-monthly-1', seats: 1 },
        { completeMandate: null },
      );
      expect(result.activated).toBe(false);
      expect(result.mandateUrl).toContain('sub_mock_');
      expect(await row()).toMatchObject({ status: 'trialing' });
    });
  });

  it('refuses a second paid subscription and a plan that does not exist', async () => {
    await withTestDb(async (tx) => {
      const { checkout } = await setup(tx);
      await checkout({ planId: 'advocate-monthly-1', seats: 1 });
      await expect(checkout({ planId: 'advocate-monthly-1', seats: 1 })).rejects.toMatchObject({
        name: 'WorkspaceError',
      });
    });
    await withTestDb(async (tx) => {
      const { checkout } = await setup(tx);
      await expect(checkout({ planId: 'nope', seats: 1 })).rejects.toMatchObject({
        name: 'BillingServiceError',
      });
    });
  });

  it('is FORBIDDEN in a demo workspace and never calls the provider', async () => {
    await withTestDb(async (tx) => {
      const { checkout, row, provider } = await setup(tx, { demo: true });
      await expect(checkout({ planId: 'advocate-monthly-1', seats: 1 })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(await row()).toBeUndefined();
      expect(provider.deliveries()).toHaveLength(0);
    });
  });
});

describe('updateSubscriptionPaymentMethod', () => {
  it('recovers a past-due subscription: mandate restarted, charge applied, dunning cleared', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, provider, checkout, updateMethod, row, audits } = await setup(tx);
      await checkout({ planId: 'advocate-monthly-1', seats: 1 });
      const current = await row();
      await provider.simulate(current?.providerSubscriptionId ?? '', 'payment.failed');
      await inWorkspace(tx, workspaceId, (s) =>
        s
          .update(schema.subscription)
          .set({ status: 'past_due', dunningStartedAt: AT, dunningAttempts: 1 })
          .where(eq(schema.subscription.workspaceId, workspaceId)),
      );
      const result = await updateMethod();
      expect(result).toMatchObject({ completed: true, mandateUrl: null });
      expect(await row()).toMatchObject({
        status: 'active',
        dunningStartedAt: null,
        dunningAttempts: 0,
      });
      expect(await audits('billing.payment_method_updated')).toHaveLength(1);
    });
  });

  it('returns the hosted link when the provider does not complete the mandate', async () => {
    await withTestDb(async (tx) => {
      const { checkout, updateMethod } = await setup(tx);
      await checkout({ planId: 'advocate-monthly-1', seats: 1 });
      const result = await updateMethod(null as never);
      expect(result.completed).toBe(false);
      expect(result.mandateUrl).toContain('sub_mock_');
    });
  });
});
