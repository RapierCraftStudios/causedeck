// `system.usage.rollup` (#222, #30 part 5): every hour, copy each workspace's `usage_counter` totals
// for the previous and current IST months into `usage_period_summary`, the table billing reports
// read. A month that has ended is closed on the first run after it: its summary gets `closed_at`
// and never changes again (the 0018 `usage_period_summary_immutable` trigger rejects any update,
// and the upsert below skips closed rows), so a re-run is a no-op for closed months and refreshes
// open ones. Usage recorded late against a closed month stays in `usage_counter` only. Summaries of
// periods older than 13 months are pruned. `usage_counter` and `usage_period_summary` are under
// FORCE row-level security and this job has no workspace, so it lists workspace ids through the
// owner-defined `app_usage_rollup_targets` function, writes each workspace inside its own
// `withWorkspace` scope and prunes through `app_purge_usage_period_summaries` (0018_usage_rollup).
// Only keys, numbers and ids are written or logged. Workspace-less jobs are `system.*` by rule.
import { schema, withWorkspace } from '@causedeck/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { periodStart } from '../../usage/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

const { usageCounter, usagePeriodSummary } = schema;

/** Closed summaries are kept for this many IST months before the current one. */
export const USAGE_SUMMARY_RETENTION_MONTHS = 13;

export interface UsageRollupDeps {
  now?: () => Date;
}

export interface UsageRollupReport {
  /** Workspaces with usage in the previous or current month. */
  workspaces: number;
  /** Summary rows inserted or refreshed (closed rows are never rewritten). */
  upserted: number;
  /** Of those, rows written closed: the month-end close. */
  closed: number;
  /** Summaries pruned by retention. */
  pruned: number;
}

/** Start of the IST month `months` before the one starting at `start`. */
function monthsBefore(start: Date, months: number): Date {
  let at = start;
  for (let i = 0; i < months; i++) at = periodStart(new Date(at.getTime() - 1));
  return at;
}

/** Roll up, close finished months and prune old summaries. Exported for tests. */
export async function runUsageRollup(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: UsageRollupDeps = {},
): Promise<UsageRollupReport> {
  const now = deps.now?.() ?? new Date();
  const current = periodStart(now);
  const previous = monthsBefore(current, 1);
  const report: UsageRollupReport = { workspaces: 0, upserted: 0, closed: 0, pruned: 0 };

  const targets = await ctx.db.execute<{ workspace_id: string }>(
    sql`select workspace_id::text from app_usage_rollup_targets(${previous.toISOString()}::timestamptz)`,
  );
  for (const { workspace_id: workspaceId } of targets) {
    const rows = await withWorkspace(ctx.db, { workspaceId }, (tx) =>
      tx.execute<{ closed: boolean }>(sql`
        insert into ${usagePeriodSummary} as s (workspace_id, key, period_start, value, closed_at)
        select c.workspace_id, c.key, c.period_start, c.value,
               case when c.period_start < ${current.toISOString()}::timestamptz
                    then ${now.toISOString()}::timestamptz end
        from ${usageCounter} c
        where c.workspace_id = ${workspaceId}
          and c.period_start >= ${previous.toISOString()}::timestamptz
        on conflict (workspace_id, key, period_start)
          do update set value = excluded.value, closed_at = excluded.closed_at
          where s.closed_at is null
        returning s.closed_at is not null as closed`),
    );
    report.workspaces += 1;
    report.upserted += rows.length;
    report.closed += rows.filter((r) => r.closed).length;
  }

  const cutoff = monthsBefore(current, USAGE_SUMMARY_RETENTION_MONTHS);
  const [purged] = await ctx.db.execute<{ deleted: string }>(
    sql`select app_purge_usage_period_summaries(${cutoff.toISOString()}::timestamptz)::text as deleted`,
  );
  report.pruned = Number(purged?.deleted ?? 0);

  ctx.log.info({ ...report }, 'usage rollup complete');
  return report;
}

export const usageRollup = defineJob({
  name: 'system.usage.rollup',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'usage-rollup', policy: 'stately' },
  // Hourly, a quarter past; the month-end close lands on the first run after 00:00 IST on the 1st.
  schedule: { cron: '15 * * * *', payload: {} },
  handler: async (ctx) => {
    await runUsageRollup(ctx);
  },
});
