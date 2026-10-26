// The enquiry retention sweep (#87, ADR 0043): a closed enquiry is deleted once it has been closed
// for the workspace's `enquiry_retention_months` (default 12). Its parties and stored conflict checks
// go with it (cascade). The daily `system.enquiry.retention` job lists the workspaces with closed
// enquiries through `app_enquiry_retention_targets` (ids only) and sweeps each in its own scope.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';

const { enquiry, workspaceSettings } = schema;

export const ENQUIRY_RETENTION_DEFAULT_MONTHS = 12;
/** Enquiries deleted per sweep of one workspace; the next run takes the rest. */
export const ENQUIRY_RETENTION_BATCH = 500;

/** The first instant a closed enquiry is past retention: `months` calendar months before `now`. */
export function retentionCutoff(now: Date, months: number): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

export async function sweepClosedEnquiries(
  deps: { db: Database | Transaction; now?: () => Date },
  workspaceId: string,
): Promise<{ deleted: number }> {
  const now = deps.now?.() ?? new Date();
  return withWorkspace(deps.db, { workspaceId }, async (tx) => {
    const [settings] = await tx
      .select({ months: workspaceSettings.enquiryRetentionMonths })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, workspaceId));
    const months = settings?.months ?? ENQUIRY_RETENTION_DEFAULT_MONTHS;
    const due = await tx
      .select({ id: enquiry.id })
      .from(enquiry)
      .where(
        and(
          eq(enquiry.workspaceId, workspaceId),
          eq(enquiry.status, 'closed'),
          isNotNull(enquiry.closedAt),
          lte(enquiry.closedAt, retentionCutoff(now, months)),
        ),
      )
      .limit(ENQUIRY_RETENTION_BATCH);
    if (due.length === 0) return { deleted: 0 };
    await tx.delete(enquiry).where(
      and(
        eq(enquiry.workspaceId, workspaceId),
        inArray(
          enquiry.id,
          due.map((row) => row.id),
        ),
      ),
    );
    await record(
      { db: tx, workspaceId, actor: { userId: null, kind: 'system' } },
      { action: 'enquiry.retention_swept', metadata: { deleted: due.length, months } },
    );
    return { deleted: due.length };
  });
}

/** The workspaces that hold closed enquiries old enough for the shortest retention (one month). */
export async function enquiryRetentionTargets(
  db: Database | Transaction,
  now: Date,
): Promise<string[]> {
  const rows = await db.execute<{ workspace_id: string }>(
    sql`select workspace_id::text from app_enquiry_retention_targets(${now.toISOString()}::timestamptz)`,
  );
  return rows.map((row) => row.workspace_id);
}
