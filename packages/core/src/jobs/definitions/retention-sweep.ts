// `system.retention.sweep`: daily stub of the retention job (PRD §8). For now it only expires
// `job_effect` rows older than 30 days; raw audio, memory and crypto-erase windows arrive with
// their domains. Under #19's forced RLS this delete needs `withoutWorkspace`.
import { schema } from '@causedeck/db';
import { lt, sql } from 'drizzle-orm';
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
    const deleted = await ctx.db
      .delete(schema.jobEffect)
      .where(lt(schema.jobEffect.completedAt, cutoff))
      .returning({ id: schema.jobEffect.id });
    ctx.log.info({ deleted: deleted.length }, 'expired job_effect rows');
  },
});
