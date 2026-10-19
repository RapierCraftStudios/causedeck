// Billing schema (#200): the migrated tables, their constraints and the tenant conventions.
import { randomUUID } from 'node:crypto';

import { getTableConfig } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { checkSchemaConventions, GLOBAL_TABLES, tablesOf } from '../conventions.ts';
import { organization } from '../schema/auth.ts';
import { billingEvent, entitlement, plan, subscription, usageCounter } from '../schema/billing.ts';
import * as schema from '../schema/index.ts';
import { seedPlans } from '../seed/plans.ts';
import { closeTestDb, withTestDb } from '../testing/index.ts';
import type { Transaction } from '../client.ts';

afterAll(closeTestDb);

const TENANT_TABLES = [subscription, entitlement, usageCounter, billingEvent];

/** Run `fn` in a savepoint and return the violated constraint's name (or undefined on success). */
async function violation(tx: Transaction, fn: (sp: Transaction) => Promise<unknown>) {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
    });
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { constraint_name?: string } }).cause;
    return cause?.constraint_name ?? (error as { constraint_name?: string }).constraint_name;
  }
}

async function newWorkspace(tx: Transaction): Promise<string> {
  const id = randomUUID();
  await tx.insert(organization).values({ id, name: 'Test Chambers', slug: `ws-${id}` });
  return id;
}

describe('billing schema (#200)', () => {
  it('migrates the five billing tables', async () => {
    const rows = await withTestDb((tx) =>
      tx.execute<{ name: string }>(
        sql`select tablename as name from pg_tables where schemaname = 'public' and tablename in ('plan', 'subscription', 'entitlement', 'usage_counter', 'billing_event') order by 1`,
      ),
    );
    expect(rows.map((r) => r.name)).toEqual([
      'billing_event',
      'entitlement',
      'plan',
      'subscription',
      'usage_counter',
    ]);
  });

  it('keeps plan global and the other billing tables workspace-scoped', () => {
    expect(GLOBAL_TABLES).toContain('plan');
    for (const table of TENANT_TABLES) {
      const config = getTableConfig(table);
      expect(GLOBAL_TABLES, config.name).not.toContain(config.name);
      const ws = config.columns.find((c) => c.name === 'workspace_id');
      expect(ws?.notNull, config.name).toBe(true);
    }
    expect(checkSchemaConventions(tablesOf(schema))).toEqual([]);
    // Checked as tenant tables, the billing tables satisfy every rule on their own.
    expect(checkSchemaConventions(TENANT_TABLES, { globalTables: ['organization'] })).toEqual([]);
  });

  it('stores a valid GSTIN and null, and rejects a malformed one', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const workspaceId = await newWorkspace(tx);
      const base = { workspaceId, planId: 'chamber-seat-1', status: 'cancelled', seats: 3 };
      await tx.insert(subscription).values({ ...base, gstin: '27AAPFU0939F1ZV' });
      await tx.insert(subscription).values({ ...base, gstin: null });
      for (const gstin of ['27aapfu0939f1zv', '27AAPFU0939F1Z', '27AAPFU0939F1YV']) {
        expect(
          await violation(tx, (sp) => sp.insert(subscription).values({ ...base, gstin })),
          gstin,
        ).toBe('subscription_gstin_chk');
      }
      const stored = await tx
        .select({ gstin: subscription.gstin })
        .from(subscription)
        .where(sql`${subscription.workspaceId} = ${workspaceId}`);
      expect(stored.map((r) => r.gstin).sort()).toEqual(['27AAPFU0939F1ZV', null]);
    });
  });

  it('allows one current subscription per workspace, plus any number of ended ones', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const workspaceId = await newWorkspace(tx);
      const row = { workspaceId, planId: 'advocate-monthly-1', seats: 1 };
      await tx.insert(subscription).values({ ...row, status: 'active' });
      expect(
        await violation(tx, (sp) => sp.insert(subscription).values({ ...row, status: 'past_due' })),
      ).toBe('subscription_workspace_current_uq');
      await tx.insert(subscription).values({ ...row, status: 'cancelled' });
      await tx.insert(subscription).values({ ...row, status: 'expired' });
      // Another workspace is unaffected.
      const other = await newWorkspace(tx);
      await tx.insert(subscription).values({ ...row, workspaceId: other, status: 'trialing' });
    });
  });

  it('rejects unknown statuses, plans and seat counts', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const workspaceId = await newWorkspace(tx);
      const row = { workspaceId, planId: 'junior', status: 'active', seats: 1 };
      expect(
        await violation(tx, (sp) => sp.insert(subscription).values({ ...row, status: 'created' })),
      ).toBe('subscription_status_chk');
      expect(
        await violation(tx, (sp) => sp.insert(subscription).values({ ...row, seats: 0 })),
      ).toBe('subscription_seats_chk');
      expect(
        await violation(tx, (sp) => sp.insert(subscription).values({ ...row, planId: 'nope' })),
      ).toBe('subscription_plan_id_plan_id_fk');
    });
  });

  it('rejects invalid plan rows', async () => {
    await withTestDb(async (tx) => {
      const row = { id: 'x', name: 'X', kind: 'advocate', interval: 'month', pricePaise: 100 };
      expect(await violation(tx, (sp) => sp.insert(plan).values({ ...row, kind: 'clerk' }))).toBe(
        'plan_kind_chk',
      );
      expect(
        await violation(tx, (sp) => sp.insert(plan).values({ ...row, interval: 'week' })),
      ).toBe('plan_interval_chk');
      expect(await violation(tx, (sp) => sp.insert(plan).values({ ...row, pricePaise: -1 }))).toBe(
        'plan_price_chk',
      );
    });
  });

  it('records each provider event id once', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      const event = {
        providerEventId: 'evt_test_1',
        workspaceId,
        type: 'subscription.charged',
        payloadHash: 'abc',
      };
      await tx.insert(billingEvent).values(event);
      expect(await violation(tx, (sp) => sp.insert(billingEvent).values(event))).toBe(
        'billing_event_pkey',
      );
    });
  });

  it('keys entitlements and usage counters by workspace', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      await tx.insert(entitlement).values({ workspaceId, key: 'max_active_matters', value: 15 });
      expect(
        await violation(tx, (sp) =>
          sp.insert(entitlement).values({ workspaceId, key: 'max_active_matters', value: 20 }),
        ),
      ).toBe('entitlement_pkey');
      const periodStart = new Date('2026-10-01T00:00:00+05:30');
      await tx.insert(usageCounter).values({ workspaceId, key: 'ai_paise', periodStart, value: 7 });
      expect(
        await violation(tx, (sp) =>
          sp.insert(usageCounter).values({ workspaceId, key: 'ai_paise', periodStart }),
        ),
      ).toBe('usage_counter_pkey');
    });
  });
});
