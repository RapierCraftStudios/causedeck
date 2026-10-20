// Usage schema (#218, #30 part 1): the four usage tables are tenant tables under FORCE RLS with
// `ws_isolation` from the migration that creates them, the ledger is idempotent per workspace, and
// the tables accept keys, numbers and ids only (no customer content).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { checkRls } from '../check-rls.ts';
import type { Transaction } from '../client.ts';
import { checkSchemaConventions, GLOBAL_TABLES, tablesOf } from '../conventions.ts';
import { createOwnerDb } from '../owner.ts';
import { missingTenantPolicies, registeredTenantTables } from '../rls-policies.ts';
import { organization, user } from '../schema/auth.ts';
import * as schema from '../schema/index.ts';
import {
  budgetOverride,
  usageEvent,
  usagePeriodSummary,
  usageReservation,
} from '../schema/usage.ts';
import { TABLE_TESTS } from '../testing/cross-tenant-registry.ts';
import { closeTestDb, inWorkspace, testDatabaseUrls, withTestDb } from '../testing/index.ts';
import { TENANT_SEEDERS } from '../testing/two-tenants.ts';

const USAGE_TABLES = [
  'budget_override',
  'usage_event',
  'usage_period_summary',
  'usage_reservation',
];
const MIGRATION = fileURLToPath(new URL('../../migrations/0010_usage.sql', import.meta.url));

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
afterAll(async () => {
  await owner.$client.end();
  await closeTestDb();
});

interface Failure {
  code?: string | undefined;
  constraint?: string | undefined;
}

/** Run `fn` in a savepoint; the SQLSTATE and constraint it failed with, or undefined. */
async function failure(
  tx: Transaction,
  fn: (sp: Transaction) => Promise<unknown>,
): Promise<Failure | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
    });
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
    const pg = cause ?? (error as { code?: string; constraint_name?: string });
    return { code: pg.code, constraint: pg.constraint_name };
  }
}

/** A workspace and a user (for `set_by`), written as the app role. */
async function setup(tx: Transaction): Promise<{ workspaceId: string; userId: string }> {
  const workspaceId = randomUUID();
  await inWorkspace(tx, workspaceId, (s) =>
    s.insert(organization).values({ id: workspaceId, name: 'Usage', slug: `ws-${workspaceId}` }),
  );
  const [row] = await tx
    .insert(user)
    .values({ name: 'Staff', email: `staff-${randomUUID()}@example.test` })
    .returning({ id: user.id });
  if (row === undefined) throw new Error('no user');
  return { workspaceId, userId: row.id };
}

describe('usage schema (#218)', () => {
  it('declares four tenant tables registered for RLS and the cross-tenant suite', () => {
    for (const table of USAGE_TABLES) {
      expect(GLOBAL_TABLES).not.toContain(table);
      expect(registeredTenantTables()).toContain(table);
      expect(TABLE_TESTS[table]).toBe('packages/db/src/__tests__/cross-tenant/tables.test.ts');
      expect(TENANT_SEEDERS[table], table).toBeTypeOf('function');
    }
    expect(checkSchemaConventions(tablesOf(schema))).toEqual([]);
  });

  it('migrates them under ENABLE + FORCE RLS with ws_isolation, in 0010_usage (owner definer policies in 0018)', async () => {
    const rows = await owner.execute<{
      name: string;
      enabled: boolean;
      forced: boolean;
      policies: string[];
    }>(sql`
      select c.relname::text as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             array(select p.policyname::text from pg_policies p
                   where p.tablename = c.relname order by 1) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any(${sql.raw(
        `array[${USAGE_TABLES.map((t) => `'${t}'`).join(', ')}]`,
      )})
      order by 1`);
    expect(rows).toEqual(
      USAGE_TABLES.map((name) => ({
        name,
        enabled: true,
        forced: true,
        // 0018_usage_rollup adds owner-only policies for the rollup's definer functions (#222);
        // 0035 adds owner_definer_read on budget_override for the staff console (#224).
        policies:
          name === 'usage_period_summary'
            ? ['owner_definer_purge', 'owner_definer_read', 'ws_isolation']
            : name === 'budget_override'
              ? ['owner_definer_read', 'ws_isolation']
              : ['ws_isolation'],
      })),
    );
    const ownerOnly = await owner.execute<{ roles: string[] }>(sql`
      select roles::text[] as roles from pg_policies
      where tablename = 'usage_period_summary' and policyname like 'owner_definer_%'`);
    expect(ownerOnly.map((p) => p.roles)).toEqual([['causedeck_owner'], ['causedeck_owner']]);
    const overrideOwnerOnly = await owner.execute<{ roles: string[] }>(sql`
      select roles::text[] as roles from pg_policies
      where tablename = 'budget_override' and policyname = 'owner_definer_read'`);
    expect(overrideOwnerOnly.map((p) => p.roles)).toEqual([['causedeck_owner']]);
    expect(await checkRls(owner)).toEqual([]);
    expect(
      missingTenantPolicies('0010_usage', readFileSync(MIGRATION, 'utf8'), GLOBAL_TABLES),
    ).toEqual([]);
  });

  it('keeps usage_event idempotent per workspace, not across workspaces', async () => {
    await withTestDb(async (outer) => {
      const a = await setup(outer);
      const b = await setup(outer);
      const event = { key: 'ai.spend_paise', amount: 12, idempotencyKey: 'call-1' };
      await inWorkspace(outer, a.workspaceId, async (tx) => {
        await tx.insert(usageEvent).values({ ...event, workspaceId: a.workspaceId });
        expect(
          await failure(tx, (sp) =>
            sp.insert(usageEvent).values({ ...event, workspaceId: a.workspaceId }),
          ),
        ).toEqual({ code: '23505', constraint: 'usage_event_workspace_idempotency_uq' });
      });
      await inWorkspace(outer, b.workspaceId, (tx) =>
        tx.insert(usageEvent).values({ ...event, workspaceId: b.workspaceId }),
      );
    });
  });

  it('accepts ids-only metadata and rejects anything that could carry content', async () => {
    await withTestDb(async (outer) => {
      const { workspaceId } = await setup(outer);
      await inWorkspace(outer, workspaceId, async (tx) => {
        const row = { workspaceId, key: 'ai.spend_paise', amount: 5 };
        await tx.insert(usageEvent).values({ ...row, idempotencyKey: randomUUID() });
        await tx.insert(usageEvent).values({
          ...row,
          idempotencyKey: randomUUID(),
          metadata: { ai_call_id: randomUUID(), matter_id: 'mat_01J:abc-DEF' },
        });
        const bad: unknown[] = [
          { note: 'client said the hearing went badly' },
          { ai_call_id: 'the hearing went badly' },
          { ai_call_id: 42 },
          { ai_call_id: { text: 'nested' } },
          { ai_call_id: 'x'.repeat(129) },
          { AI_CALL_ID: 'abc' },
          ['ai_call_id'],
          'free text',
        ];
        for (const metadata of bad) {
          expect(
            await failure(tx, (sp) =>
              sp.insert(usageEvent).values({
                ...row,
                idempotencyKey: randomUUID(),
                metadata: metadata as never,
              }),
            ),
            JSON.stringify(metadata),
          ).toEqual({ code: '23514', constraint: 'usage_event_metadata_chk' });
        }
      });
    });
  });

  it('rejects prose in keys and purposes', async () => {
    await withTestDb(async (outer) => {
      const { workspaceId, userId } = await setup(outer);
      await inWorkspace(outer, workspaceId, async (tx) => {
        const expiresAt = new Date(Date.now() + 60_000);
        for (const key of [
          'Ai.spend',
          'ai spend',
          'ai.',
          '.ai',
          'Mr Sharma v. State',
          'a'.repeat(65),
        ]) {
          expect(
            await failure(tx, (sp) =>
              sp
                .insert(usageEvent)
                .values({ workspaceId, key, amount: 1, idempotencyKey: randomUUID() }),
            ),
            key,
          ).toMatchObject({ code: '23514', constraint: 'usage_event_key_chk' });
          expect(
            await failure(tx, (sp) =>
              sp
                .insert(usagePeriodSummary)
                .values({ workspaceId, key, periodStart: new Date(), value: 1 }),
            ),
            key,
          ).toMatchObject({ code: '23514', constraint: 'usage_period_summary_key_chk' });
          expect(
            await failure(tx, (sp) =>
              sp.insert(budgetOverride).values({
                workspaceId,
                key,
                limitValue: 1,
                setBy: userId,
                reason: 'r',
                expiresAt,
              }),
            ),
            key,
          ).toMatchObject({ code: '23514', constraint: 'budget_override_key_chk' });
          expect(
            await failure(tx, (sp) =>
              sp
                .insert(usageReservation)
                .values({ workspaceId, amountPaise: 1, purpose: key, expiresAt }),
            ),
            key,
          ).toMatchObject({ code: '23514', constraint: 'usage_reservation_purpose_chk' });
        }
        await tx
          .insert(usageReservation)
          .values({ workspaceId, amountPaise: 500, purpose: 'ai.draft', expiresAt });
        expect(
          await failure(tx, (sp) =>
            sp
              .insert(usageReservation)
              .values({ workspaceId, amountPaise: -1, purpose: 'ai.draft', expiresAt }),
          ),
        ).toMatchObject({ code: '23514', constraint: 'usage_reservation_amount_chk' });
      });
    });
  });

  it('requires a non-empty reason and an expiry on budget overrides', async () => {
    await withTestDb(async (outer) => {
      const { workspaceId, userId } = await setup(outer);
      await inWorkspace(outer, workspaceId, async (tx) => {
        const row = {
          workspaceId,
          key: 'ai.spend_paise',
          limitValue: 50_000,
          setBy: userId,
          reason: 'pilot chamber, approved by support',
          expiresAt: new Date(Date.now() + 86_400_000),
        };
        await tx.insert(budgetOverride).values(row);
        expect(
          await failure(tx, (sp) => sp.insert(budgetOverride).values({ ...row, reason: '  ' })),
        ).toMatchObject({ code: '23514', constraint: 'budget_override_reason_chk' });
        expect(
          await failure(tx, (sp) =>
            sp.insert(budgetOverride).values({ ...row, reason: null as never }),
          ),
        ).toMatchObject({ code: '23502' });
        expect(
          await failure(tx, (sp) =>
            sp.insert(budgetOverride).values({ ...row, expiresAt: null as never }),
          ),
        ).toMatchObject({ code: '23502' });
        expect(
          await failure(tx, (sp) => sp.insert(budgetOverride).values({ ...row, limitValue: -1 })),
        ).toMatchObject({ code: '23514', constraint: 'budget_override_limit_chk' });
      });
    });
  });

  it('keys period summaries by workspace, key and period', async () => {
    await withTestDb(async (outer) => {
      const { workspaceId } = await setup(outer);
      await inWorkspace(outer, workspaceId, async (tx) => {
        const row = {
          workspaceId,
          key: 'ai.spend_paise',
          periodStart: new Date('2026-10-01T00:00:00+05:30'),
          value: 17_500,
        };
        await tx.insert(usagePeriodSummary).values(row);
        expect(await failure(tx, (sp) => sp.insert(usagePeriodSummary).values(row))).toEqual({
          code: '23505',
          constraint: 'usage_period_summary_pkey',
        });
      });
    });
  });
});
