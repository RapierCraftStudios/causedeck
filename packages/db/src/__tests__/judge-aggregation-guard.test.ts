// No judge aggregation (#349; PX-9, ME-6; #32 "Judge handling"): `bench.judges` records the
// court-published composition only, and no table, view or index may aggregate by judge across
// matters or workspaces. Checked three ways: the Drizzle schema (no other judge column, no views),
// the migration SQL (no view, index or aggregate over judges) and the migrated database catalog.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Secret } from '@causedeck/config/env';
import { getTableName, is, sql } from 'drizzle-orm';
import { getTableConfig, PgMaterializedView, PgView } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';

import { tablesOf } from '../conventions.ts';
import { MIGRATIONS_FOLDER } from '../migrate.ts';
import { createOwnerDb } from '../owner.ts';
import * as schema from '../schema/index.ts';
import { testDatabaseUrls } from '../testing/index.ts';

const JUDGE = /judge/i;
/** The only judge-bearing column: the composition the court publishes. */
const ALLOWED_COLUMNS = ['bench.judges'];

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
afterAll(async () => {
  await owner.$client.end();
});

/** Every statement of every migration, with its file name. */
function migrationStatements(): { file: string; statement: string }[] {
  return readdirSync(MIGRATIONS_FOLDER)
    .filter((file) => file.endsWith('.sql'))
    .flatMap((file) =>
      readFileSync(path.join(MIGRATIONS_FOLDER, file), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => ({ file, statement })),
    );
}

describe('no judge aggregation (PX-9, ME-6)', () => {
  it('declares no judge column but bench.judges, and no views', () => {
    const columns = tablesOf(schema).flatMap((table) =>
      getTableConfig(table)
        .columns.filter((column) => JUDGE.test(column.name))
        .map((column) => `${getTableName(table)}.${column.name}`),
    );
    expect(columns).toEqual(ALLOWED_COLUMNS);
    const views = Object.entries(schema)
      .filter(([, value]) => is(value, PgView) || is(value, PgMaterializedView))
      .map(([name]) => name);
    expect(views).toEqual([]);
  });

  it('creates no view, index or aggregate over judges in any migration', () => {
    const statements = migrationStatements();
    expect(statements.length).toBeGreaterThan(0);
    const offending = statements
      .filter(({ statement }) => JUDGE.test(statement.replaceAll('judge_staff', '')))
      .filter(
        ({ statement }) =>
          /create\s+(or\s+replace\s+)?(materialized\s+)?view/i.test(statement) ||
          /create\s+(unique\s+)?index/i.test(statement) ||
          /group\s+by|\b(count|array_agg|jsonb_agg|json_agg|string_agg)\s*\(|\bunnest\s*\(/i.test(
            statement,
          ),
      )
      .map(({ file, statement }) => `${file}: ${statement.trim().slice(0, 120)}`);
    expect(offending).toEqual([]);
  });

  it('has no view, index, function or other column over judges in the database', async () => {
    const views = await owner.execute<{ name: string }>(sql`
      select viewname::text as name from pg_views
      where schemaname = 'public' and definition ilike '%judge%'
      union all
      select matviewname::text from pg_matviews
      where schemaname = 'public' and definition ilike '%judge%'`);
    expect(views).toEqual([]);

    const indexes = await owner.execute<{ name: string }>(sql`
      select indexname::text as name from pg_indexes
      where schemaname = 'public' and indexdef ilike '%judge%'`);
    expect(indexes).toEqual([]);

    const functions = await owner.execute<{ name: string }>(sql`
      select p.proname::text as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ilike '%judges%'`);
    expect(functions).toEqual([]);

    const columns = await owner.execute<{ name: string }>(sql`
      select table_name || '.' || column_name as name from information_schema.columns
      where table_schema = 'public' and column_name ilike '%judge%'
      order by 1`);
    expect(columns.map((c) => c.name)).toEqual(ALLOWED_COLUMNS);
  });
});
