// Cross-tenant SQL (#19, #209): for every tenant table in the registry, workspace A (as `ua`)
// cannot read, update, delete or insert workspace B's rows, whatever the WHERE clause says, and
// B's rows are intact afterwards. Runs as causedeck_app in a rolled-back transaction.
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../client.ts';
import { TABLE_TESTS } from '../../testing/cross-tenant-registry.ts';
import { inWorkspace, withTestDb } from '../../testing/index.ts';
import { organization } from '../../schema/auth.ts';
import { seedTwoTenants, TENANT_SEEDERS } from '../../testing/two-tenants.ts';
import { sqlState } from '../rls/fixtures.ts';

const THIS_FILE = 'packages/db/src/__tests__/cross-tenant/tables.test.ts';
const tables = Object.entries(TABLE_TESTS)
  .filter(([, file]) => file === THIS_FILE)
  .map(([table]) => table);

/** The column that names a row's workspace (`organization` is the tenant root). */
const scopeColumn = (table: string) => (table === 'organization' ? 'id' : 'workspace_id');

async function count(tx: Transaction, table: string, where: string): Promise<number> {
  const [row] = await tx.execute<{ n: number }>(
    sql.raw(`select count(*)::int as n from "${table}" where ${where}`),
  );
  return row?.n ?? -1;
}

/** Insert one row for `workspaceId` while scoped elsewhere, in a savepoint. */
function insertFor(tx: Transaction, table: string, workspaceId: string, ownerId: string) {
  return tx.transaction(async (sp) => {
    if (table === 'organization') {
      await sp
        .insert(organization)
        .values({ id: workspaceId, name: 'X', slug: `xt-${randomUUID()}` });
      return;
    }
    const seeder = TENANT_SEEDERS[table];
    if (seeder === undefined) throw new Error(`no seeder for ${table}`);
    await seeder(sp, { workspaceId, ownerId, tag: `x-${randomUUID().slice(0, 8)}` });
  });
}

describe('cross-tenant SQL: every tenant table', () => {
  it('covers the registered tables', () => {
    expect(tables.length).toBeGreaterThan(13);
  });

  it.each(tables)('%s: workspace A cannot read, change or add workspace B rows', async (table) => {
    await withTestDb(async (tx) => {
      const { a, b, ua, ub } = await seedTwoTenants(tx);
      const col = scopeColumn(table);

      await inWorkspace(
        tx,
        a.id,
        async (scoped) => {
          expect(await count(scoped, table, `"${col}" = '${a.id}'`)).toBeGreaterThan(0);
          expect(await count(scoped, table, `"${col}" = '${b.id}'`)).toBe(0);
          expect(await count(scoped, table, `"${col}" <> '${a.id}'`)).toBe(0);

          const updated = await scoped.execute(
            sql.raw(
              `update "${table}" set "${col}" = "${col}" where "${col}" = '${b.id}' returning 1`,
            ),
          );
          expect(updated.length).toBe(0);
          const deleted = await scoped.execute(
            sql.raw(`delete from "${table}" where "${col}" = '${b.id}' returning 1`),
          );
          expect(deleted.length).toBe(0);

          const target = table === 'organization' ? randomUUID() : b.id;
          expect(await sqlState(insertFor(scoped, table, target, ub))).toBe('42501');
        },
        ua,
      );

      // B's seed rows are untouched and still only visible to B.
      await inWorkspace(tx, b.id, async (scoped) => {
        expect(await count(scoped, table, `"${col}" = '${b.id}'`)).toBeGreaterThan(0);
        expect(await count(scoped, table, `"${col}" = '${a.id}'`)).toBe(0);
      });
    });
  });
});
