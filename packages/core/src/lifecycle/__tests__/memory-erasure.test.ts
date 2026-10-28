// Memory and embedding erasure (#303) on the real `memory_item` / `memory_embedding` tables (#72),
// seeded in a rolled-back owner transaction (FORCE RLS binds the owner too). A request by an owner,
// run by the priority job on a fake clock, leaves no row of the workspace in either table within
// 24 h, and never touches another workspace's rows.

import { Secret } from '@causedeck/config/env';
import { createDb, schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { testDatabaseUrls } from '@causedeck/db/testing';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq, sql, TransactionRollbackError } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  eraseMemory,
  MEMORY_ERASE_BATCH,
  MEMORY_ERASURE_SLA_MS,
  requestMemoryErasure,
  runMemoryErasure,
} from '../index.ts';

import { captureLog } from './fixtures.ts';

let owner: Database;
beforeAll(() => {
  owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
});
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

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const ZERO_VECTOR = sql`('[' || array_to_string(array_fill(0, array[1024]), ',') || ']')::vector`;

/** `items` memory items for `workspaceId`, each with one embedding, plus `extra` more on the first. */
async function seedMemory(
  tx: Transaction,
  workspaceId: string,
  ownerId: string,
  items: number,
  extra = 0,
) {
  await withWorkspace(tx, { workspaceId }, async (s) => {
    await s.execute(sql`
      with i as (
        insert into memory_item (workspace_id, layer, key, scope, owner_user_id, value_ciphertext, source_type, confirmation_state)
        select ${workspaceId}::uuid, 'M2', 'M2.always_carry', 'workspace', ${ownerId}::uuid, 'ct-' || g, 'manual', 'confirmed'
        from generate_series(1, ${items}) g
        returning id)
      insert into memory_embedding (workspace_id, item_id, content_ref, embedding)
      select ${workspaceId}::uuid, i.id, 'emb', ${ZERO_VECTOR} from i`);
    if (extra > 0) {
      await s.execute(sql`
        insert into memory_embedding (workspace_id, item_id, content_ref, embedding)
        select ${workspaceId}::uuid, (select id from memory_item where workspace_id = ${workspaceId}::uuid limit 1), 'extra-' || g, ${ZERO_VECTOR}
        from generate_series(1, ${extra}) g`);
    }
  });
}

async function memoryRows(tx: Transaction, workspaceId: string) {
  return withWorkspace(tx, { workspaceId }, async (s) => {
    const [row] = await s.execute<{ items: number; embeddings: number }>(sql`
      select (select count(*)::int from memory_item where workspace_id = ${workspaceId}::uuid) as items,
             (select count(*)::int from memory_embedding where workspace_id = ${workspaceId}::uuid) as embeddings`);
    return row;
  });
}

/** `seedTwoTenants` already holds one row of every memory table per workspace: the baseline. */
async function baseline(tx: Transaction, workspaceId: string) {
  const row = await memoryRows(tx, workspaceId);
  return { items: row?.items ?? 0, embeddings: row?.embeddings ?? 0 };
}

const T0 = new Date('2026-10-20T10:00:00.000Z');

describe('memory erasure', () => {
  it('an owner request, run by the job, erases every memory row of the workspace within 24 h', async () => {
    await rolledBack(async (tx) => {
      const seeded: TwoTenants = await seedTwoTenants(tx);
      const baseA = await baseline(tx, seeded.a.id);
      const baseB = await baseline(tx, seeded.b.id);
      // More embeddings than one batch, so the batched delete loops.
      await seedMemory(tx, seeded.a.id, seeded.ua, 3, MEMORY_ERASE_BATCH + 5);
      await seedMemory(tx, seeded.b.id, seeded.ub, 2);

      const enqueue = vi.fn(() => Promise.resolve(null));
      const job = await requestMemoryErasure(
        { db: tx, workspaceId: seeded.a.id, userId: seeded.ua, now: () => T0 },
        { enqueue },
      );
      expect(job.status).toBe('scheduled');
      expect(job.eraseAfter?.getTime()).toBe(T0.getTime() + MEMORY_ERASURE_SLA_MS);
      expect(enqueue).toHaveBeenCalledWith({ workspaceId: seeded.a.id, jobId: job.id });
      // Nothing is erased before the job runs.
      expect(await memoryRows(tx, seeded.a.id)).toEqual({
        items: baseA.items + 3,
        embeddings: baseA.embeddings + MEMORY_ERASE_BATCH + 8,
      });

      const ranAt = new Date(T0.getTime() + 5 * 60_000);
      const { log, lines } = captureLog();
      const outcome = await runMemoryErasure(
        { db: tx, log, now: () => ranAt },
        { workspaceId: seeded.a.id, jobId: job.id },
      );
      expect(outcome).toEqual({
        status: 'erased',
        counts: {
          memory_embedding: baseA.embeddings + MEMORY_ERASE_BATCH + 8,
          memory_item: baseA.items + 3,
          precedent_passage: 1,
        },
      });
      expect(await memoryRows(tx, seeded.a.id)).toEqual({ items: 0, embeddings: 0 });
      expect(await memoryRows(tx, seeded.b.id)).toEqual({
        items: baseB.items + 2,
        embeddings: baseB.embeddings + 2,
      });
      expect(lines.join('\n')).not.toContain('ct-');

      const [row] = await withWorkspace(tx, { workspaceId: seeded.a.id }, (s) =>
        s.select().from(schema.deletionJob).where(eq(schema.deletionJob.id, job.id)),
      );
      expect(row?.status).toBe('erased');
      const completed = row?.completedAt?.getTime() ?? Infinity;
      expect(completed - T0.getTime()).toBeLessThan(MEMORY_ERASURE_SLA_MS);
      expect(completed).toBeLessThanOrEqual(row?.eraseAfter?.getTime() ?? 0);
      const events = await withWorkspace(tx, { workspaceId: seeded.a.id }, (s) =>
        s
          .select({ action: schema.auditEvent.action, metadata: schema.auditEvent.metadata })
          .from(schema.auditEvent)
          .where(eq(schema.auditEvent.targetId, job.id)),
      );
      expect(events.map((e) => e.action).sort()).toEqual([
        'memory.erased',
        'memory.erasure_requested',
      ]);

      // Idempotent: a second run (a retried job) changes nothing.
      expect(
        await runMemoryErasure({ db: tx, log }, { workspaceId: seeded.a.id, jobId: job.id }),
      ).toEqual({ status: 'already-erased', counts: {} });
    });
  });

  it('a second request while one is pending returns it without enqueueing again', async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const enqueue = vi.fn(() => Promise.resolve(null));
      const ctx = { db: tx, workspaceId: seeded.a.id, userId: seeded.ua };
      const first = await requestMemoryErasure(ctx, { enqueue });
      const again = await requestMemoryErasure(ctx, { enqueue });
      expect(again.id).toBe(first.id);
      expect(enqueue).toHaveBeenCalledTimes(1);
    });
  });

  it('erases the seeded fixture rows of one workspace and leaves the other', async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const baseA = await baseline(tx, seeded.a.id);
      const baseB = await baseline(tx, seeded.b.id);
      expect(baseA.items).toBeGreaterThan(0);
      expect(await eraseMemory(tx, seeded.a.id)).toEqual({
        memory_embedding: baseA.embeddings,
        memory_item: baseA.items,
        precedent_passage: 1,
      });
      expect(await memoryRows(tx, seeded.a.id)).toEqual({ items: 0, embeddings: 0 });
      expect(await memoryRows(tx, seeded.b.id)).toEqual(baseB);
    });
  });

  it("only owners may request it, and B can neither request nor run an erasure of A's memory", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const baseA = await baseline(tx, seeded.a.id);
      await seedMemory(tx, seeded.a.id, seeded.ua, 2);
      const enqueue = vi.fn(() => Promise.resolve(null));
      // uboth is an advocate of A; ub owns B only.
      expect(
        await codeOf(
          requestMemoryErasure(
            { db: tx, workspaceId: seeded.a.id, userId: seeded.uboth },
            { enqueue },
          ),
        ),
      ).toBe('FORBIDDEN');
      expect(
        await codeOf(
          requestMemoryErasure(
            { db: tx, workspaceId: seeded.a.id, userId: seeded.ub },
            { enqueue },
          ),
        ),
      ).toMatch(/^(FORBIDDEN|NOT_FOUND)$/);
      expect(enqueue).not.toHaveBeenCalled();

      // A's job id run under B's workspace finds nothing, and erasing B leaves A intact.
      const aJob = await requestMemoryErasure(
        { db: tx, workspaceId: seeded.a.id, userId: seeded.ua },
        { enqueue },
      );
      const { log } = captureLog();
      expect(
        await runMemoryErasure({ db: tx, log }, { workspaceId: seeded.b.id, jobId: aJob.id }),
      ).toEqual({ status: 'missing', counts: {} });
      await eraseMemory(tx, seeded.b.id);
      expect(await memoryRows(tx, seeded.a.id)).toEqual({
        items: baseA.items + 2,
        embeddings: baseA.embeddings + 2,
      });
    });
  });
});
