// Memory and embedding erasure (#303, part 3 of #31; NFR Privacy: memory and embeddings are deleted
// within 24 h of a request; docs/engineering/data-lifecycle.md "Memory erasure").
//
// - `requestMemoryErasure`: owners only. Schedules one `deletion_job` (`kind` `memory`) with
//   `erase_after` = request + 24 h (the SLA deadline), records `memory.erasure_requested`
//   (fail-closed) in the same transaction and enqueues the priority `memory.erase` job with ids
//   only. A second request while one is pending returns it.
// - `eraseMemory`: deletes the workspace's rows from every `MEMORY_TABLES` table that exists, in
//   batches, under the caller's workspace scope (row-level security keeps other workspaces out).
//   The real tables arrive in a later milestone; until then a missing table is skipped, and the
//   tests create fixtures in a rolled-back transaction (packages/db/src/__tests__/rls/vector.test.ts).
// - `runMemoryErasure`: the job body, in one workspace transaction: erase, mark the job `erased`
//   with per-table counts and record `memory.erased`. Idempotent; an erased job is a no-op.
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import type { DeletionStatus } from '@causedeck/db/schema';
import type { Logger } from '@causedeck/observability';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { record } from '../../audit/index.ts';
import { requireOwner } from '../../workspaces/index.ts';

const { deletionJob } = schema;

/** Memory tables, children first (embeddings reference items). */
export const MEMORY_TABLES = ['memory_embedding', 'memory_item'] as const;

/** A memory erasure completes within this long of its request (NFR Privacy). */
export const MEMORY_ERASURE_SLA_MS = 24 * 60 * 60 * 1000;

/** pg-boss priority of `memory.erase` (higher runs first; the default is 0). */
export const MEMORY_ERASE_PRIORITY = 10;

/** Rows deleted per statement. */
export const MEMORY_ERASE_BATCH = 1000;

export interface MemoryErasureJob {
  id: string;
  workspaceId: string;
  status: DeletionStatus;
  createdAt: Date;
  /** The SLA deadline: request + 24 h. */
  eraseAfter: Date | null;
  completedAt: Date | null;
}

export interface MemoryErasureCtx {
  db: Queryable;
  workspaceId: string;
  userId: string;
  requestId?: string;
  userAgent?: string;
  ip?: string;
  now?: () => Date;
}

export interface RequestMemoryErasureDeps {
  /** Enqueue `memory.erase` (ids only, priority); `requestMemoryErasureFor` in core/runtime. */
  enqueue: (job: { workspaceId: string; jobId: string }) => Promise<unknown>;
}

type Row = typeof deletionJob.$inferSelect;

const toJob = (row: Row): MemoryErasureJob => ({
  id: row.id,
  workspaceId: row.workspaceId ?? '',
  status: row.status,
  createdAt: row.createdAt,
  eraseAfter: row.eraseAfter,
  completedAt: row.completedAt,
});

/** Request the erasure of the current workspace's memory and embeddings. */
export async function requestMemoryErasure(
  ctx: MemoryErasureCtx,
  deps: RequestMemoryErasureDeps,
): Promise<MemoryErasureJob> {
  const scope = { workspaceId: ctx.workspaceId, userId: ctx.userId };
  const { job, created } = await withWorkspace(ctx.db, scope, async (tx) => {
    await requireOwner(tx, ctx.workspaceId, ctx.userId);
    const [active] = await tx
      .select()
      .from(deletionJob)
      .where(
        and(
          eq(deletionJob.workspaceId, ctx.workspaceId),
          eq(deletionJob.kind, 'memory'),
          inArray(deletionJob.status, ['scheduled', 'running']),
        ),
      )
      .limit(1);
    if (active !== undefined) return { job: active, created: false };
    const now = ctx.now?.() ?? new Date();
    const [row] = await tx
      .insert(deletionJob)
      .values({
        workspaceId: ctx.workspaceId,
        kind: 'memory',
        requestedBy: ctx.userId,
        status: 'scheduled',
        eraseAfter: new Date(now.getTime() + MEMORY_ERASURE_SLA_MS),
        createdAt: now,
      })
      .returning();
    if (row === undefined) throw new Error('requestMemoryErasure: insert returned no row');
    await record(
      {
        db: tx,
        workspaceId: ctx.workspaceId,
        actor: { userId: ctx.userId, kind: 'user' },
        ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
        ...(ctx.userAgent === undefined ? {} : { userAgent: ctx.userAgent }),
        ...(ctx.ip === undefined ? {} : { ip: ctx.ip }),
      },
      { action: 'memory.erasure_requested', target: { kind: 'deletion_job', id: row.id } },
    );
    return { job: row, created: true };
  });
  if (created) await deps.enqueue({ workspaceId: ctx.workspaceId, jobId: job.id });
  return toJob(job);
}

/**
 * Delete `workspaceId`'s rows from every memory table that exists, in the caller's scope (a
 * `withWorkspace` transaction for that workspace). Returns the rows deleted per table.
 */
export async function eraseMemory(
  db: Queryable,
  workspaceId: string,
): Promise<Record<string, number>> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const counts: Record<string, number> = {};
    for (const table of MEMORY_TABLES) {
      const [present] = await tx.execute<{ present: boolean }>(
        sql`select to_regclass(${`public.${table}`}) is not null as present`,
      );
      if (present?.present !== true) continue;
      const name = sql.identifier(table);
      let total = 0;
      for (;;) {
        const [row] = await tx.execute<{ n: number }>(sql`
          with d as (
            delete from ${name} where ctid in (
              select ctid from ${name} where workspace_id = ${workspaceId}::uuid
              limit ${MEMORY_ERASE_BATCH})
            returning 1)
          select count(*)::int as n from d`);
        const n = row?.n ?? 0;
        total += n;
        if (n < MEMORY_ERASE_BATCH) break;
      }
      counts[table] = total;
    }
    return counts;
  });
}

export interface MemoryErasureRunCtx {
  db: Queryable;
  log: Pick<Logger, 'info' | 'warn'>;
  now?: () => Date;
}

export interface MemoryErasureOutcome {
  status: 'erased' | 'already-erased' | 'missing';
  counts: Record<string, number>;
}

/** The `memory.erase` job body. */
export async function runMemoryErasure(
  ctx: MemoryErasureRunCtx,
  { workspaceId, jobId }: { workspaceId: string; jobId: string },
): Promise<MemoryErasureOutcome> {
  const outcome = await withWorkspace(ctx.db, { workspaceId }, async (tx) => {
    const [job] = await tx
      .select()
      .from(deletionJob)
      .where(
        and(
          eq(deletionJob.id, jobId),
          eq(deletionJob.workspaceId, workspaceId),
          eq(deletionJob.kind, 'memory'),
        ),
      )
      .for('update');
    if (job === undefined) return { status: 'missing' as const, counts: {} };
    if (job.status === 'erased') return { status: 'already-erased' as const, counts: {} };
    if (job.status !== 'scheduled' && job.status !== 'running') {
      return { status: 'missing' as const, counts: {} };
    }
    const counts = await eraseMemory(tx, workspaceId);
    const at = ctx.now?.() ?? new Date();
    await tx
      .update(deletionJob)
      .set({
        status: 'erased',
        completedAt: at,
        steps: { ...job.steps, tables: counts, erasedAt: at.toISOString() },
      })
      .where(eq(deletionJob.id, jobId));
    await record(
      { db: tx, workspaceId, actor: { userId: null, kind: 'system' } },
      {
        action: 'memory.erased',
        target: { kind: 'deletion_job', id: jobId },
        metadata: Object.fromEntries(Object.entries(counts).map(([t, n]) => [`rows_${t}`, n])),
      },
    );
    return { status: 'erased' as const, counts };
  });
  if (outcome.status === 'erased') ctx.log.info({ jobId, workspaceId }, 'memory erased');
  return outcome;
}
