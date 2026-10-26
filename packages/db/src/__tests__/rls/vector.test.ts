// pgvector under row-level security (#19, #209): a similarity search as workspace A never returns
// workspace B's rows, even when B holds the nearest vectors and the limit exceeds A's row count.
// The `memory_embedding`-shaped fixture table is created with its tenantPolicy() in a rolled-back
// owner transaction (FORCE RLS binds the owner too).
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { sql, TransactionRollbackError } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import type { Transaction } from '../../client.ts';
import { createOwnerDb } from '../../owner.ts';
import { tenantPolicy } from '../../rls-policies.ts';
import { withWorkspace } from '../../rls.ts';
import { organization } from '../../schema/auth.ts';
import { testDatabaseUrls } from '../../testing/index.ts';
import { EMBEDDING_DIMENSIONS } from '../../vector.ts';

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
afterAll(async () => {
  await owner.$client.end();
});

async function rolledBack(fn: (tx: Transaction) => Promise<void>): Promise<void> {
  const state = { done: false };
  try {
    await owner.transaction(async (tx) => {
      await fn(tx);
      state.done = true;
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError) || !state.done) throw error;
  }
}

/** A unit-ish vector pointing mostly along `axis`, with `jitter` on the next axis. */
function vec(axis: number, jitter = 0): string {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[axis] = 1;
  v[(axis + 1) % EMBEDDING_DIMENSIONS] = jitter;
  return `[${v.join(',')}]`;
}

async function createMemoryEmbedding(tx: Transaction): Promise<void> {
  await tx.execute(
    sql.raw(`create table memory_embedding (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references organization (id) on delete cascade,
      content_ref text not null,
      embedding vector(${String(EMBEDDING_DIMENSIONS)}) not null
    )`),
  );
  await tx.execute(
    sql.raw('create index memory_embedding_workspace_id_idx on memory_embedding (workspace_id)'),
  );
  for (const statement of tenantPolicy('memory_embedding')) await tx.execute(sql.raw(statement));
}

async function seed(tx: Transaction, workspaceId: string, rows: [string, string][]): Promise<void> {
  await withWorkspace(tx, { workspaceId }, async (s) => {
    await s
      .insert(organization)
      .values({ id: workspaceId, name: 'Vec', slug: `vec-${workspaceId}` });
    for (const [ref, embedding] of rows) {
      await s.execute(
        sql`insert into memory_embedding (workspace_id, content_ref, embedding) values (${workspaceId}::uuid, ${ref}, ${embedding}::vector)`,
      );
    }
  });
}

function nearest(tx: Transaction, query: string, k: number) {
  return tx.execute<{ workspace_id: string; content_ref: string }>(
    sql`select workspace_id::text as workspace_id, content_ref from memory_embedding
        order by embedding <=> ${query}::vector limit ${k}`,
  );
}

describe('pgvector similarity under RLS', () => {
  it('a nearest-neighbour query as workspace A never returns B rows', async () => {
    await rolledBack(async (tx) => {
      await createMemoryEmbedding(tx);
      const [a, b] = [randomUUID(), randomUUID()];
      await seed(tx, a, [
        ['a-far-1', vec(10)],
        ['a-far-2', vec(20)],
      ]);
      // B's vectors are the closest to the query.
      await seed(tx, b, [
        ['b-near-1', vec(0)],
        ['b-near-2', vec(0, 0.01)],
        ['b-near-3', vec(0, 0.02)],
      ]);

      const query = vec(0);
      const asA = await withWorkspace(tx, { workspaceId: a }, (s) => nearest(s, query, 10));
      expect(asA.map((r) => r.content_ref).sort()).toEqual(['a-far-1', 'a-far-2']);
      expect(asA.every((r) => r.workspace_id === a)).toBe(true);

      const asB = await withWorkspace(tx, { workspaceId: b }, (s) => nearest(s, query, 1));
      expect(asB.map((r) => r.content_ref)).toEqual(['b-near-1']);

      // With no workspace pinned nothing is returned.
      expect(await nearest(tx, query, 10)).toHaveLength(0);
    });
  });
});
