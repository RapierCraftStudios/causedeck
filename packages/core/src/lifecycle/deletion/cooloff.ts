// Workspace deletion cool-off (#302; docs/engineering/data-lifecycle.md). A request waits 14 days
// in `pending_cooloff`, cancellable by any owner. `system.deletion.tick` runs hourly: it lists due
// deletions (ids only) through the owner-defined `app_deletion_due_jobs` (0032), moves each one
// whose cool-off has ended to `scheduled` in its own workspace's scope, and enqueues
// `deletion.erase`. A job a crash left `scheduled` or `running` is enqueued again (the erase is
// resumable and singleton per job). Nothing is ever erased before `cooloff_until`.
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import type { Logger } from '@causedeck/observability';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';

const { deletionJob } = schema;

/** The cooling-off period between a deletion request and erasure: 14 days. */
export const DELETION_COOLOFF_MS = 14 * 24 * 60 * 60 * 1000;

export interface DeletionTickReport {
  scheduled: number;
  enqueued: number;
}

export interface DeletionTickDeps {
  now?: () => Date;
  /**
   * Enqueue `deletion.erase` (ids only). The job lives in the `jobs` domain, which depends on this
   * one, so the tick job passes it in.
   */
  enqueue: (job: { workspaceId: string; jobId: string }) => Promise<unknown>;
}

/** Schedule and enqueue every workspace deletion whose cool-off has ended. Idempotent. */
export async function runDeletionTick(
  ctx: { db: Queryable; log: Pick<Logger, 'info'> },
  deps: DeletionTickDeps,
): Promise<DeletionTickReport> {
  const now = deps.now?.() ?? new Date();
  const due = await ctx.db.execute<{ id: string; workspace_id: string }>(
    sql`select id::text, workspace_id::text from app_deletion_due_jobs(${now.toISOString()}::timestamptz)`,
  );
  const report: DeletionTickReport = { scheduled: 0, enqueued: 0 };
  for (const { id, workspace_id: workspaceId } of due) {
    const ready = await withWorkspace(ctx.db, { workspaceId }, async (tx) => {
      const [row] = await tx
        .update(deletionJob)
        .set({ status: 'scheduled' })
        .where(
          and(
            eq(deletionJob.id, id),
            eq(deletionJob.status, 'pending_cooloff'),
            lte(deletionJob.cooloffUntil, now),
          ),
        )
        .returning({ id: deletionJob.id });
      if (row !== undefined) {
        report.scheduled += 1;
        return true;
      }
      const [left] = await tx
        .select({ id: deletionJob.id })
        .from(deletionJob)
        .where(and(eq(deletionJob.id, id), inArray(deletionJob.status, ['scheduled', 'running'])));
      return left !== undefined;
    });
    if (!ready) continue;
    await deps.enqueue({ workspaceId, jobId: id });
    report.enqueued += 1;
  }
  ctx.log.info(report, 'workspace deletions ticked');
  return report;
}
