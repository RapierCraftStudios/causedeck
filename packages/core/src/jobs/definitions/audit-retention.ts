// `system.audit.retention` (#230, #26 part 5): daily purge of audit events and AI call records older
// than the retention window. CERT-In requires Indian logs to be kept for at least 180 days, so the
// window is at least 180 days (default 400): the payload schema and the handler refuse less, and
// the purge functions (`app_purge_audit`, `app_purge_ai_calls`, 0008_audit) refuse any cutoff
// younger than 180 days themselves. The job never deletes directly: those owner-defined functions
// are the only path past the append-only trigger. The purge and its `audit.retention_purged`
// summary event (account chain, security action, fail-closed) commit or roll back together.
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { record } from '../../audit/writer.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';
import { PermanentError } from '../errors.ts';

/** CERT-In: logs are kept in India for at least 180 days. */
export const AUDIT_RETENTION_MIN_DAYS = 180;
export const AUDIT_RETENTION_DEFAULT_DAYS = 400;

/** Refuse a retention window shorter than 180 days (or not a whole number of days). */
export function assertRetentionDays(days: number): void {
  if (!Number.isInteger(days) || days < AUDIT_RETENTION_MIN_DAYS) {
    throw new PermanentError(
      'AUDIT_RETENTION_TOO_SHORT',
      `audit retention must be a whole number of days, at least ${String(AUDIT_RETENTION_MIN_DAYS)}`,
    );
  }
}

export interface AuditRetentionReport {
  retentionDays: number;
  cutoff: string;
  auditDeleted: number;
  aiCallsDeleted: number;
}

/** Purge everything older than `retentionDays` and audit the purge. Exported for tests. */
export async function runAuditRetention(
  ctx: Pick<JobContext, 'db' | 'log'>,
  retentionDays: number,
): Promise<AuditRetentionReport> {
  assertRetentionDays(retentionDays);
  const report = await ctx.db.transaction(async (tx) => {
    const [cut] = await tx.execute<{ cutoff: string }>(
      sql`select to_char((now() - make_interval(days => ${retentionDays}::int)) at time zone 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cutoff`,
    );
    const cutoff = cut?.cutoff ?? '';
    const [audit] = await tx.execute<{ deleted: string }>(
      sql`select app_purge_audit(${cutoff}::timestamptz)::text as deleted`,
    );
    const [aiCalls] = await tx.execute<{ deleted: string }>(
      sql`select app_purge_ai_calls(${cutoff}::timestamptz)::text as deleted`,
    );
    const result: AuditRetentionReport = {
      retentionDays,
      cutoff,
      auditDeleted: Number(audit?.deleted ?? 0),
      aiCallsDeleted: Number(aiCalls?.deleted ?? 0),
    };
    await record(
      { db: tx, workspaceId: null, actor: { userId: null, kind: 'system' } },
      { action: 'audit.retention_purged', metadata: { ...result } },
    );
    return result;
  });
  ctx.log.info(
    {
      retentionDays,
      auditDeleted: report.auditDeleted,
      aiCallsDeleted: report.aiCallsDeleted,
    },
    'audit retention purge',
  );
  return report;
}

export const auditRetention = defineJob({
  name: 'system.audit.retention',
  schema: z.object({
    workspaceId: z.null().optional(),
    retentionDays: z
      .number()
      .int()
      .min(AUDIT_RETENTION_MIN_DAYS)
      .default(AUDIT_RETENTION_DEFAULT_DAYS),
  }),
  concurrency: 1,
  singleton: { key: () => 'audit-retention', policy: 'stately' },
  schedule: { cron: '0 3 * * *', payload: {} },
  handler: async (ctx, { retentionDays }) => {
    await runAuditRetention(ctx, retentionDays);
  },
});
