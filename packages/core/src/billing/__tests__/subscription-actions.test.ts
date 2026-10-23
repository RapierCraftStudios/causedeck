// Owner billing actions against a real Postgres (#257): the snapshot columns are persisted, an
// audit event is recorded, and the GSTIN is normalised, cleared or rejected while issued invoices
// stay untouched. Every test runs in a rolled-back transaction; the mock provider adopts the row
// like the web app does (`apps/web/lib/billing-provider.ts`).
import { randomUUID } from 'node:crypto';

import { gstinCheckDigit, InvalidGstinError } from '@causedeck/billing';
import { createMockBillingProvider, MOCK_EPOCH } from '@causedeck/billing/provider';
import { createBillingService } from '@causedeck/billing/service';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createWorkspace } from '../../workspaces/index.ts';
import {
  cancelSubscriptionAtPeriodEnd,
  changeSubscriptionPlan,
  changeSubscriptionSeats,
  quoteSubscriptionChange,
  resumeSubscription,
  setSubscriptionGstin,
  type BillingActionContext,
  type SubscriptionRow,
} from '../index.ts';

const PERIOD_END = new Date('2026-02-01T00:00:00Z');
const AT = new Date(MOCK_EPOCH.getTime() + 10 * 86_400_000);
const GSTIN = `27AAPFU0939F1Z${gstinCheckDigit('27AAPFU0939F1Z')}`;
const PARTY = { legalName: 'Party', address: 'Chennai', gstin: null, stateCode: '33' };

async function setup(tx: Transaction, planId = 'chamber-seat-1') {
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
  await inWorkspace(tx, workspaceId, (s) =>
    s.insert(schema.subscription).values({
      workspaceId,
      planId,
      status: 'active',
      seats: 3,
      clerkSeats: 0,
      currentPeriodStart: MOCK_EPOCH,
      currentPeriodEnd: PERIOD_END,
      providerSubscriptionId: `sub_${randomUUID().slice(0, 8)}`,
      providerCustomerId: 'cust_test',
    }),
  );
  const provider = createMockBillingProvider({ now: () => AT });
  const service = async (row: SubscriptionRow) => {
    await provider.adoptSubscription({
      id: row.providerSubscriptionId ?? '',
      customerId: row.providerCustomerId,
      planId: row.planId,
      quantity: row.seats,
      status: row.status === 'paused' ? 'paused' : 'active',
      currentStart: row.currentPeriodStart,
      currentEnd: row.currentPeriodEnd,
      cancelAtCycleEnd: row.cancelAtPeriodEnd,
    });
    return createBillingService({ provider, now: () => AT });
  };
  const run = <T>(fn: (ctx: BillingActionContext) => Promise<T>) =>
    inWorkspace(tx, workspaceId, (s) => fn({ tx: s, workspaceId, actorUserId: user.id, service }));
  const row = () =>
    inWorkspace(tx, workspaceId, async (s) => {
      const [found] = await s
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.workspaceId, workspaceId));
      if (!found) throw new Error('no subscription');
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
  return { workspaceId, userId: user.id, run, row, audits };
}

describe('owner subscription changes', () => {
  it('persists a seat increase and records an audit event', async () => {
    await withTestDb(async (tx) => {
      const { run, row, audits } = await setup(tx);
      const result = await run((ctx) => changeSubscriptionSeats(ctx, { seats: 5, clerkSeats: 1 }));
      expect(result.charge?.amountPaise).toBeGreaterThan(0);
      expect(await row()).toMatchObject({ seats: 5, clerkSeats: 1, status: 'active' });
      const [event] = await audits('billing.subscription_changed');
      expect(event?.metadata).toMatchObject({ change: 'seats', seats: 5, clerkSeats: 1 });
    });
  });

  it('persists an upgrade now and leaves a downgrade on the current plan until period end', async () => {
    await withTestDb(async (tx) => {
      const { run, row } = await setup(tx);
      await run((ctx) =>
        changeSubscriptionPlan(ctx, { planId: 'chamber-seat-2', seats: 3, clerkSeats: 0 }),
      );
      expect((await row()).planId).toBe('chamber-seat-2');
      await run((ctx) =>
        changeSubscriptionPlan(ctx, { planId: 'chamber-seat-1', seats: 3, clerkSeats: 0 }),
      );
      expect((await row()).planId).toBe('chamber-seat-2');
    });
  });

  it('cancels at period end and resumes', async () => {
    await withTestDb(async (tx) => {
      const { run, row } = await setup(tx);
      await run((ctx) => cancelSubscriptionAtPeriodEnd(ctx));
      expect(await row()).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
      await run((ctx) => resumeSubscription(ctx));
      expect(await row()).toMatchObject({ status: 'active', cancelAtPeriodEnd: false });
    });
  });

  it('quotes a change from the stored row', async () => {
    await withTestDb(async (tx) => {
      const { run } = await setup(tx);
      const quote = await run((ctx) =>
        quoteSubscriptionChange(
          ctx.tx,
          ctx.workspaceId,
          { planId: 'chamber-seat-2', seats: 3, clerkSeats: 0 },
          AT,
        ),
      );
      expect(quote).toMatchObject({
        basePaise: 194_700,
        gstPaise: 35_046,
        totalPaise: 229_746,
        prorationPaise: 30_484,
        effective: 'now',
      });
    });
  });
});

describe('setSubscriptionGstin', () => {
  it('normalises and saves, clears when empty, and records an audit event', async () => {
    await withTestDb(async (tx) => {
      const { run, row, audits } = await setup(tx);
      expect(await run((ctx) => setSubscriptionGstin(ctx, `  ${GSTIN.toLowerCase()} `))).toBe(
        GSTIN,
      );
      expect((await row()).gstin).toBe(GSTIN);
      expect(await run((ctx) => setSubscriptionGstin(ctx, ''))).toBeNull();
      expect((await row()).gstin).toBeNull();
      expect(await audits('billing.gstin_updated')).toHaveLength(2);
    });
  });

  it('rejects an invalid GSTIN and keeps the saved one', async () => {
    await withTestDb(async (tx) => {
      const { run, row } = await setup(tx);
      await run((ctx) => setSubscriptionGstin(ctx, GSTIN));
      const wrongCheck = `${GSTIN.slice(0, 14)}${GSTIN.endsWith('A') ? 'B' : 'A'}`;
      for (const bad of ['27AAPFU', wrongCheck]) {
        await expect(run((ctx) => setSubscriptionGstin(ctx, bad))).rejects.toBeInstanceOf(
          InvalidGstinError,
        );
      }
      expect((await row()).gstin).toBe(GSTIN);
    });
  });

  it('changes only subscription.gstin: issued invoices keep their recipient', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, run } = await setup(tx);
      const number = `G${randomUUID().slice(0, 6)}/000001`;
      await inWorkspace(tx, workspaceId, (s) =>
        s.insert(schema.saasInvoice).values({
          workspaceId,
          series: 'CD',
          fy: '26-27',
          number,
          status: 'issued',
          issueDate: '2026-01-05',
          totalPaise: 117_882,
          supplier: PARTY,
          recipient: PARTY,
          placeOfSupplyStateCode: '33',
        }),
      );
      const before = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.saasInvoice).where(eq(schema.saasInvoice.number, number)),
      );
      await run((ctx) => setSubscriptionGstin(ctx, GSTIN));
      const after = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.saasInvoice).where(eq(schema.saasInvoice.number, number)),
      );
      expect(after).toEqual(before);
      expect(after[0]?.recipient).toMatchObject({ gstin: null });
    });
  });
});
