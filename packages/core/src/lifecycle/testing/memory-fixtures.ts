// Test-only DDL for the real `memory_item` / `memory_embedding` tables, which arrive in a later
// milestone (#303). Created inside a rolled-back owner transaction (FORCE RLS binds the owner too).
import { tenantPolicy, type Transaction } from '@causedeck/db';
import { sql } from 'drizzle-orm';

// No FK to `organization`: `create table ... references organization` takes SHARE ROW EXCLUSIVE on
// that shared table and so waits for (and blocks) every concurrent test transaction that wrote a
// workspace, which stalled this file for the full test timeout under the parallel core suite.
export async function createMemoryFixtures(tx: Transaction): Promise<void> {
  await tx.execute(sql`create table memory_item (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    content_ref text not null)`);
  await tx.execute(sql`create table memory_embedding (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    item_id uuid references memory_item (id),
    content_ref text not null)`);
  for (const table of ['memory_item', 'memory_embedding']) {
    await tx.execute(sql.raw(`create index ${table}_workspace_id_idx on ${table} (workspace_id)`));
    for (const statement of tenantPolicy(table)) await tx.execute(sql.raw(statement));
  }
}
