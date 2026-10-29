// Reset of a demo workspace (#93): delete every row the workspace owns (the seed's and anything a
// visitor added), delete its ephemeral visitors, and write the seed again. The tables are found in
// the catalogue (every public table with a `workspace_id`) and deleted children first by their
// foreign keys, so a table added later is reset without touching this file. Append-only tables
// (the audit chain, AI call log) and tables the connecting role may not delete from (the deletion
// tombstones) keep their rows. A table whose rows only a parent's cascade may delete (the drafting
// versions) is skipped too: deleting its parent removes it. The workspace row itself stays, so ids, slug and
// `is_demo` are stable and sessions of the seeded members survive.
import { sql } from 'drizzle-orm';

import { withWorkspace } from '../../rls.ts';
import type { SeedDb } from '../index.ts';

import { seedDemoWorkspace } from './seed.ts';
import { visitorEmailPattern } from './shared.ts';
import { demoWorkspace, type DemoWorkspaceKey } from './workspaces.ts';

export interface DemoResetResult {
  workspaceId: string;
  tables: number;
  rows: number;
  visitors: number;
}

interface Row {
  [column: string]: unknown;
}

/** Tables in delete order: a table comes before every table its rows reference. */
export function deleteOrder(
  tables: readonly string[],
  edges: readonly [string, string][],
): string[] {
  const remaining = new Set(tables);
  const ordered: string[] = [];
  while (remaining.size > 0) {
    // A table is deletable once no remaining table references it.
    const ready = [...remaining].filter(
      (t) => !edges.some(([child, parent]) => parent === t && child !== t && remaining.has(child)),
    );
    if (ready.length === 0) {
      throw new Error(`demo reset: foreign key cycle among ${[...remaining].sort().join(', ')}`);
    }
    for (const t of ready.sort()) {
      ordered.push(t);
      remaining.delete(t);
    }
  }
  return ordered;
}

/** Delete the workspace's rows and visitors, then reseed it for `today`. */
export async function resetDemoWorkspace(
  db: SeedDb,
  key: DemoWorkspaceKey,
  { today }: { today?: string } = {},
): Promise<DemoResetResult> {
  const ws = demoWorkspace(key);
  let tables = 0;
  let rows = 0;
  await withWorkspace(db, { workspaceId: ws.id }, async (tx) => {
    const found = await tx.execute<Row>(sql`
      select c.table_name::text as name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'workspace_id' and t.table_type = 'BASE TABLE'
        and has_table_privilege(format('%I.%I', c.table_schema, c.table_name), 'DELETE')
        and not exists (
          select 1 from pg_trigger g join pg_class k on k.oid = g.tgrelid
          where k.relname = c.table_name and not g.tgisinternal and (g.tgtype & 8) <> 0 and g.tgfoid::regproc::text ~ '^app_.*immutable$'
        )`);
    const names = [...found].map((r) => String(r.name));
    const fks = await tx.execute<Row>(sql`
      select cc.relname::text as child, pc.relname::text as parent
      from pg_constraint c
      join pg_class cc on cc.oid = c.conrelid
      join pg_class pc on pc.oid = c.confrelid
      join pg_namespace n on n.oid = cc.relnamespace
      where c.contype = 'f' and n.nspname = 'public'`);
    const edges = [...fks].map((r): [string, string] => [String(r.child), String(r.parent)]);
    for (const name of deleteOrder(names, edges)) {
      const deleted = await tx.execute<Row>(
        sql`delete from ${sql.identifier(name)} where workspace_id = ${ws.id}::uuid returning 1 as n`,
      );
      tables += 1;
      rows += [...deleted].length;
    }
  });

  // Visitors are ordinary users with no workspace data of their own: their sessions go with them.
  const gone = await db.execute<Row>(
    sql`delete from "user" where email like ${visitorEmailPattern(key)} returning 1 as n`,
  );
  await seedDemoWorkspace(db, key, today === undefined ? {} : { today });
  return { workspaceId: ws.id, tables, rows, visitors: [...gone].length };
}
