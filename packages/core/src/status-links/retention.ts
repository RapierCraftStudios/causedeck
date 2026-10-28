// The status link retention sweep (#88, ADR 0049): the payload of a link expired for 30 days is
// cleared (`{}`) and the link marked purged. The nightly job lists the workspaces through the
// owner-defined `app_status_link_purge_targets` (ids only) and sweeps each in its own scope. It never
// reads the legal-gated flag: deleting expired data is not the feature.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';

const { statusLink } = schema;

export const STATUS_LINK_PURGE_DAYS = 30;

export async function statusLinkPurgeTargets(
  db: Database | Transaction,
  now: Date,
): Promise<string[]> {
  const rows = await db.execute<{ workspace_id: string }>(
    sql`select workspace_id::text from app_status_link_purge_targets(${now.toISOString()}::timestamptz)`,
  );
  return rows.map((row) => row.workspace_id);
}

export async function purgeExpiredStatusLinks(
  deps: { db: Database | Transaction; now?: () => Date },
  workspaceId: string,
): Promise<{ purged: number }> {
  const now = deps.now?.() ?? new Date();
  const cutoff = new Date(now.getTime() - STATUS_LINK_PURGE_DAYS * 24 * 60 * 60 * 1000);
  return withWorkspace(deps.db, { workspaceId }, async (tx) => {
    const rows = await tx
      .update(statusLink)
      .set({ payload: {}, purgedAt: now, updatedAt: now })
      .where(
        and(
          eq(statusLink.workspaceId, workspaceId),
          isNull(statusLink.purgedAt),
          lte(statusLink.expiresAt, cutoff),
        ),
      )
      .returning({ id: statusLink.id });
    if (rows.length > 0) {
      await record(
        { db: tx, workspaceId, actor: { userId: null, kind: 'system' } },
        {
          action: 'status_link.purged',
          target: { kind: 'status_link', id: workspaceId },
          metadata: { purged: rows.length },
        },
      );
    }
    return { purged: rows.length };
  });
}
