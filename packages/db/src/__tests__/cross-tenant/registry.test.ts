// The cross-tenant registry for tables (#19, #209): every tenant table in the live, migrated
// database (introspected: a `workspace_id` column and not in GLOBAL_TABLES), every table registered
// through `tenantTable()` and the tenant root `organization` must have a cross-tenant test and a
// two-tenant seeder. A new tenant table without them fails `pnpm test:tenancy`.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { GLOBAL_TABLES } from '../../conventions.ts';
import { createOwnerDb } from '../../owner.ts';
import { registeredTenantTables } from '../../rls-policies.ts';
import {
  registeredTestFiles,
  staleEntries,
  TABLE_TESTS,
  unregisteredTables,
} from '../../testing/cross-tenant-registry.ts';
import { testDatabaseUrls } from '../../testing/index.ts';
import { TENANT_SEEDERS, unseededTenantTables } from '../../testing/two-tenants.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
afterAll(async () => {
  await owner.$client.end();
});

async function liveTenantTables(): Promise<string[]> {
  const globals = sql.raw(`array[${GLOBAL_TABLES.map((t) => `'${t}'`).join(', ')}]::text[]`);
  const rows = await owner.execute<{ name: string }>(sql`
    select c.relname::text as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace_id')
      and not (c.relname = any(${globals}))
    order by 1`);
  return rows.map((r) => r.name);
}

describe('cross-tenant registry: tables', () => {
  it('registers a cross-tenant test for every live tenant table and every tenantTable()', async () => {
    const live = await liveTenantTables();
    expect(live.length).toBeGreaterThan(0);
    expect(
      unregisteredTables([...live, ...registeredTenantTables(), 'organization']),
      'tenant tables without a cross-tenant test: add them to TABLE_TESTS',
    ).toEqual([]);
    expect(staleEntries(TABLE_TESTS, [...live, 'organization'])).toEqual([]);
  });

  it('has a two-tenant seeder for every tenant table', async () => {
    expect(unseededTenantTables()).toEqual([]);
    const live = await liveTenantTables();
    expect(live.filter((t) => !(t in TENANT_SEEDERS))).toEqual([]);
  });

  it('points only at test files that exist', () => {
    for (const file of registeredTestFiles()) {
      expect(existsSync(`${REPO_ROOT}${file}`), file).toBe(true);
    }
  });

  it('reports a tenant table that has no entry', () => {
    expect(unregisteredTables(['member', 'xt_new_matter'])).toEqual(['xt_new_matter']);
    expect(staleEntries({ member: 1, xt_gone: 1 }, ['member'])).toEqual(['xt_gone']);
  });
});
