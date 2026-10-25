// Internal bench facts (#521, D-050): the app role has no grant on `bench_sitting_fact`; the
// owner-defined `app_bench_*` functions are the only way in or out, and none returns a name.
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { GLOBAL_TABLES } from '../conventions.ts';
import { withTestDb } from '../testing/index.ts';
import { sqlState } from './rls/fixtures.ts';

const DENIED = [
  'select * from bench_sitting_fact',
  `insert into bench_sitting_fact (source_id, hall_no, sitting_date, items_listed, items_heard, items_disposed) values ('s', 'h', '2026-01-01', 1, 1, 1)`,
  `update bench_sitting_fact set items_listed = 0`,
  'delete from bench_sitting_fact',
];

describe('bench_sitting_fact grants', () => {
  it('is a global table', () => {
    expect(GLOBAL_TABLES).toContain('bench_sitting_fact');
  });

  it.each(DENIED)('denies the app role: %s', async (statement) => {
    await withTestDb(async (tx) => {
      expect(await sqlState(tx.execute(sql.raw(statement)))).toBe('42501');
    });
  });

  it('lets the definer functions write and read the facts', async () => {
    await withTestDb(async (tx) => {
      const source = `in.xt.bench-facts-${Math.random().toString(36).slice(2, 8)}`;
      await tx.execute(
        sql`select app_bench_fact_record(${source}, '7', '2026-01-05'::date, null::uuid, 10, 8, 6, 4.5::numeric)`,
      );
      await tx.execute(
        sql`select app_bench_fact_record(${source}, '7', '2026-01-05'::date, null::uuid, 12, 9, 7, 5::numeric)`,
      );
      const pace = await tx.execute<{ minutes_per_item: string }>(
        sql`select minutes_per_item::text from app_bench_pace(${source}, '7', '2026-01-01'::date)`,
      );
      expect(pace).toEqual([{ minutes_per_item: '5.00' }]);
    });
  });

  it('returns no judge name from any function', async () => {
    await withTestDb(async (tx) => {
      const columns = await tx.execute<{ name: string; args: string }>(sql`
        select p.proname::text as name, pg_get_function_result(p.oid) as args
          from pg_proc p where p.proname like 'app\_bench\_%' order by 1`);
      expect(columns.map((c) => c.name)).toEqual([
        'app_bench_card',
        'app_bench_fact_record',
        'app_bench_for_halls',
        'app_bench_pace',
      ]);
      for (const c of columns) expect(c.args).not.toMatch(/judge|name|rate|score|rank/i);
    });
  });
});
