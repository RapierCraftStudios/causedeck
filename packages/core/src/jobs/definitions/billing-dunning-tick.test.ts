// `system.billing.dunning-tick` (#205) on the Testcontainers database, as causedeck_app in a
// rolled-back transaction: past_due subscriptions in several workspaces are retried through the
// mock provider on the dunning days, moved to grace and then downgraded, and each stage notifies
// the owners once through `billing.notice`. Nothing is deleted.
import { randomUUID } from 'node:crypto';

import { createMockBillingProvider, type MockBillingProvider } from '@causedeck/billing/provider';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import type { DeliveryJob } from '@causedeck/notifications';
import type { Logger } from '@causedeck/observability';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getWorkspaceEntitlements } from '../../billing/entitlements.ts';
import { registry } from '../registry.ts';
import { billingDunningTick, runBillingDunningTick } from './billing-dunning-tick.ts';

const DAY_MS = 86_400_000;
const START = new Date('2026-03-01T06:00:00.000Z');
const day = (n: number) => new Date(START.getTime() + n * DAY_MS);

const ctx = (db: Transaction) => ({
  db,
  log: { info: vi.fn(), warn: vi.fn() } as unknown as Logger,
});

async function pendingAtProvider(provider: MockBillingProvider) {
  const customer = await provider.createCustomer({ email: 'accounts-dunning@example.in' });
  const created = await provider.createSubscription({
    customerId: customer.id,
    planId: 'chamber-seat-1',
    quantity: 3,
  });
  await provider.authorizeMandate(created.id);
  await provider.simulate(created.id, 'payment.failed');
  return created.id;
}

async function seedWorkspace(
  tx: Transaction,
  providerSubscriptionId: string | null,
  over: Partial<typeof schema.subscription.$inferInsert> = {},
) {
  const workspaceId = randomUUID();
  const users: { id: string; role: 'owner' | 'advocate' }[] = [];
  for (const role of ['owner', 'advocate'] as const) {
    const [u] = await tx
      .insert(schema.user)
      .values({ name: role, email: `${role}-${randomUUID()}@example.test` })
      .returning({ id: schema.user.id });
    if (!u) throw new Error('user insert failed');
    users.push({ id: u.id, role });
  }
  await inWorkspace(tx, workspaceId, async (s) => {
    await s
      .insert(schema.organization)
      .values({ id: workspaceId, name: 'Dunning', slug: `dunning-${workspaceId}` });
    for (const u of users) {
      await s
        .insert(schema.member)
        .values({ organizationId: workspaceId, userId: u.id, role: u.role });
    }
    await s.insert(schema.subscription).values({
      workspaceId,
      planId: 'chamber-seat-1',
      status: 'past_due',
      seats: 3,
      provider: 'mock',
      providerSubscriptionId,
      dunningStartedAt: START,
      dunningAttempts: 0,
      ...over,
    });
  });
  const [owner, other] = users as [(typeof users)[number], (typeof users)[number]];
  return { workspaceId, ownerId: owner.id, memberId: other.id };
}

const subscriptionOf = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, async (s) => {
    const [row] = await s
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.workspaceId, workspaceId));
    if (!row) throw new Error('subscription missing');
    return row;
  });

const noticesOf = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) =>
    s
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.workspaceId, workspaceId))
      .orderBy(schema.notification.createdAt),
  );

/** Row counts of every tenant table the dunning path touches, to prove nothing is deleted. */
const counts = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, async (s) => {
    const [row] = await s.execute<{ subs: number; members: number; orgs: number }>(
      sql`select (select count(*)::int from subscription) as subs,
                 (select count(*)::int from member) as members,
                 (select count(*)::int from organization where id = ${workspaceId}) as orgs`,
    );
    return row;
  });

describe('system.billing.dunning-tick', () => {
  it('is registered as a daily system job after reconcile', () => {
    expect(registry.get('system.billing.dunning-tick')).toBe(billingDunningTick);
    expect(billingDunningTick.schedule?.cron).toBe('30 4 * * *');
    expect(billingDunningTick.schema.parse({})).toEqual({});
  });

  it('retries on the dunning days, enters grace, downgrades and notifies owners once per stage', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const subId = await pendingAtProvider(provider);
      const ws = await seedWorkspace(tx, subId);
      const bystander = await seedWorkspace(tx, null, { status: 'active', dunningStartedAt: null });
      const before = await counts(tx, ws.workspaceId);
      const retry = vi.spyOn(provider, 'retryPayment');
      const deliveries: DeliveryJob[] = [];
      const enqueueDelivery = (job: DeliveryJob) => {
        deliveries.push(job);
        return Promise.resolve(null);
      };
      const entitlementsAt = (now: Date) =>
        inWorkspace(tx, ws.workspaceId, (s) => getWorkspaceEntitlements(s, ws.workspaceId, now));
      const tick = (n: number) =>
        runBillingDunningTick(ctx(tx), provider, { now: () => day(n), enqueueDelivery });

      // Day 1: the first retry, with the payment_failed and retry_1 notices to the owner only.
      const first = await tick(1);
      expect(first).toMatchObject({ retried: 1, halted: 0, downgraded: 0 });
      expect(retry).toHaveBeenCalledTimes(1);
      expect(retry).toHaveBeenCalledWith(subId);
      expect((await subscriptionOf(tx, ws.workspaceId)).dunningAttempts).toBe(1);
      let notices = await noticesOf(tx, ws.workspaceId);
      expect(notices.map((n) => n.title)).toEqual([
        'Your subscription payment did not go through',
        'Payment retry 1 of 4',
      ]);
      expect(notices.every((n) => n.userId === ws.ownerId && n.category === 'billing.notice')).toBe(
        true,
      );
      expect(notices[0]?.href).toBe(`/w/dunning-${ws.workspaceId}/settings/billing`);
      // Email is on by default for billing.notice: one email delivery per notice.
      expect(deliveries).toEqual(
        notices.map((n) => ({
          workspaceId: ws.workspaceId,
          notificationId: n.id,
          channel: 'email',
        })),
      );

      // A rerun the same day retries nothing and sends nothing new.
      expect(await tick(1.5)).toMatchObject({ retried: 0 });
      expect(retry).toHaveBeenCalledTimes(1);
      expect(await noticesOf(tx, ws.workspaceId)).toHaveLength(2);
      expect(deliveries).toHaveLength(2);

      for (const [n, attempts] of [
        [3, 2],
        [5, 3],
        [7, 4],
      ] as const) {
        await tick(n);
        expect((await subscriptionOf(tx, ws.workspaceId)).dunningAttempts).toBe(attempts);
      }
      expect(retry).toHaveBeenCalledTimes(4);

      // Day 8, still unpaid: grace with full access for 7 days.
      expect(await tick(8)).toMatchObject({ halted: 1, retried: 0 });
      let row = await subscriptionOf(tx, ws.workspaceId);
      expect(row.status).toBe('past_due');
      expect(row.graceUntil).toEqual(day(15));
      expect((await entitlementsAt(day(10))).features.write).toBe(true);

      await tick(14);
      expect((await subscriptionOf(tx, ws.workspaceId)).status).toBe('past_due');

      // After grace: downgraded (expired), read-only Junior, nothing deleted.
      expect(await tick(15)).toMatchObject({ downgraded: 1 });
      row = await subscriptionOf(tx, ws.workspaceId);
      expect(row.status).toBe('expired');
      const ents = await entitlementsAt(day(15));
      expect(ents.features.write).toBe(false);
      expect(ents.max_active_matters).toBe(15);
      expect(await counts(tx, ws.workspaceId)).toEqual(before);

      notices = await noticesOf(tx, ws.workspaceId);
      expect(notices.map((n) => n.title)).toEqual([
        'Your subscription payment did not go through',
        'Payment retry 1 of 4',
        'Payment retry 2 of 4',
        'Payment retry 3 of 4',
        'Payment retry 4 of 4',
        'Your workspace has a 7-day grace period',
        'Your workspace is now read-only',
      ]);
      expect(notices.every((n) => n.userId === ws.ownerId)).toBe(true);

      // The expired row is no longer a target.
      expect(await tick(16)).toMatchObject({ checked: 0 });

      const other = await subscriptionOf(tx, bystander.workspaceId);
      expect(other).toMatchObject({ status: 'active', dunningAttempts: 0 });
      expect(await noticesOf(tx, bystander.workspaceId)).toHaveLength(0);
    });
  });

  it('keeps going when the provider fails for one workspace and does not count that attempt', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const ok = await seedWorkspace(tx, await pendingAtProvider(provider));
      const broken = await seedWorkspace(tx, 'sub_mock_unknown');
      const report = await runBillingDunningTick(ctx(tx), provider, {
        now: () => day(1),
        enqueueDelivery: () => Promise.resolve(null),
      });
      expect(report).toMatchObject({ checked: 2, retried: 1 });
      expect((await subscriptionOf(tx, ok.workspaceId)).dunningAttempts).toBe(1);
      expect((await subscriptionOf(tx, broken.workspaceId)).dunningAttempts).toBe(0);
      expect(await noticesOf(tx, broken.workspaceId)).toHaveLength(0);
    });
  });
});
