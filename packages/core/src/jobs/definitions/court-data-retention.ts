// `system.court-data.retention` (#486, D-048): daily blanking of global court documents past their
// source's retention (`source.retention_days`). Runs through the app role: `contributed_document`
// is global (no RLS) and the app role may UPDATE it, never DELETE.
import { z } from 'zod';

import { expireCourtData } from '../../lifecycle/index.ts';
import { defineJob } from '../define.ts';

export const courtDataRetention = defineJob({
  name: 'system.court-data.retention',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'court-data-retention', policy: 'stately' },
  // Daily 04:15 IST (schedules run in Asia/Kolkata).
  schedule: { cron: '15 4 * * *', payload: {} },
  handler: async (ctx) => {
    const report = await expireCourtData(ctx.db);
    ctx.log.info({ expired: report.expired }, 'court data retention');
  },
});
