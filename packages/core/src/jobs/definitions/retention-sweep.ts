// `system.retention.sweep`: daily stub of the retention job (PRD §8). For now it only expires
// `job_effect` rows older than 30 days; raw audio, memory and crypto-erase windows arrive with
// their domains. `job_effect` is a tenant table under FORCE row-level security (#19), and this job
// has no workspace, so the delete runs in the owner-defined `app_purge_job_effects` function
// (0006_rls_baseline) rather than by widening the app role's scope.
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineJob } from '../define.ts';

export const JOB_EFFECT_RETENTION_DAYS = 30;

export const retentionSweep = defineJob({
  name: 'system.retention.sweep',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'retention-sweep', policy: 'stately' },
  schedule: { cron: '30 3 * * *', payload: {} },
  handler: async (ctx) => {
    const cutoff = sql`now() - make_interval(days => ${JOB_EFFECT_RETENTION_DAYS})`;
    const [row] = await ctx.db.execute<{ deleted: string }>(
      sql`select app_purge_job_effects(${cutoff})::text as deleted`,
    );
    ctx.log.info({ deleted: Number(row?.deleted ?? 0) }, 'expired job_effect rows');
  },
});
