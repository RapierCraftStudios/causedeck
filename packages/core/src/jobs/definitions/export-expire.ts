// `system.export.expire` (#301): hourly, deletes workspace exports 24 h after they became ready.
// It has no workspace, so it lists due exports (ids only) through the owner-defined
// `app_export_due_jobs` function (0025_lifecycle); each export is then expired inside its own
// workspace's `withWorkspace` scope: the row becomes `expired` (download token cleared), the
// encrypted object is deleted and its `blob` row removed. Idempotent: an export already expired,
// or an object already gone, is skipped. Logs carry ids and counts only.
import { serverEnv } from '@causedeck/config/env';
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import { createObjectStoreFromEnv, type ObjectKey, type ObjectStore } from '@causedeck/storage';
import { and, eq, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

const { blob, exportJob } = schema;

export interface ExportExpireReport {
  expired: number;
}

let defaultStore: ObjectStore | undefined;

/** Expire every ready export whose `expires_at` has passed. Exported for tests. */
export async function runExportExpire(
  ctx: { db: Queryable; log: Pick<JobContext['log'], 'info'> },
  deps: { store?: ObjectStore; now?: () => Date } = {},
): Promise<ExportExpireReport> {
  const now = deps.now?.() ?? new Date();
  const store = deps.store ?? (defaultStore ??= createObjectStoreFromEnv(serverEnv()));
  const due = await ctx.db.execute<{ id: string; workspace_id: string }>(
    sql`select id::text, workspace_id::text from app_export_due_jobs(${now.toISOString()}::timestamptz)`,
  );
  let expired = 0;
  for (const { id, workspace_id: workspaceId } of due) {
    const key = await withWorkspace(ctx.db, { workspaceId }, async (tx) => {
      const [row] = await tx
        .update(exportJob)
        .set({ status: 'expired', downloadTokenHash: null })
        .where(
          and(eq(exportJob.id, id), eq(exportJob.status, 'ready'), lte(exportJob.expiresAt, now)),
        )
        .returning({ blobId: exportJob.blobId });
      if (row?.blobId == null) return null;
      const [gone] = await tx
        .delete(blob)
        .where(and(eq(blob.id, row.blobId), eq(blob.workspaceId, workspaceId)))
        .returning({ key: blob.key });
      return gone?.key ?? null;
    });
    if (key !== null) await store.delete(key as ObjectKey);
    expired += 1;
  }
  ctx.log.info({ expired }, 'exports expired');
  return { expired };
}

export const exportExpire = defineJob({
  name: 'system.export.expire',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'export-expire', policy: 'stately' },
  schedule: { cron: '15 * * * *', payload: {} },
  handler: async (ctx) => {
    await runExportExpire(ctx);
  },
});
