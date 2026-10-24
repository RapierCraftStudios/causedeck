// `system.business.digest` (#519, D-049): every Monday morning (IST) email the founders the week's
// business digest: MRR and ARR, active users, conversion, churn, cost to serve per user by plan,
// margin and any plan over the cost-per-user threshold. The job has no workspace, so `once()` does
// not apply; the singleton key and the weekly schedule give one send per week, and the subject
// carries the week. Nothing is sent when no founder is configured. Aggregates only.
import { z } from 'zod';

import {
  buildBusinessReport,
  evaluateCostThresholds,
  readBusinessSnapshot,
  renderBusinessDigest,
} from '../../business/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

import {
  businessIstDay,
  resolveBusinessDeps,
  type BusinessJobDeps,
} from './business-cost-alert.ts';
import { notificationJobDeps } from './notification-deliver.ts';

export interface BusinessDigestReport {
  sent: number;
}

/** Build and email the digest. Exported for tests. */
export async function runBusinessDigest(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: BusinessJobDeps = {},
): Promise<BusinessDigestReport> {
  const now = deps.now?.() ?? new Date();
  const { config, founders } = resolveBusinessDeps(deps);
  if (founders.length === 0) {
    ctx.log.info('business digest: no founders configured');
    return { sent: 0 };
  }

  const snapshot = await (deps.snapshot?.() ?? readBusinessSnapshot(ctx.db, now));
  const report = buildBusinessReport(snapshot, config);
  const breaches = evaluateCostThresholds(report, config.costAlertPaisePerUser);
  const email = deps.email ?? notificationJobDeps(ctx.log).email;
  const message = renderBusinessDigest(report, breaches, businessIstDay(now));
  for (const to of founders) {
    await email.send({ to, ...message, tags: { template: 'business.digest' } });
  }
  ctx.log.info({ sent: founders.length, breaches: breaches.length }, 'business digest sent');
  return { sent: founders.length };
}

export const businessDigest = defineJob({
  name: 'system.business.digest',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'business-digest', policy: 'stately' },
  // Mondays at 09:00 IST.
  schedule: { cron: '0 9 * * 1', payload: {} },
  handler: async (ctx) => {
    await runBusinessDigest(ctx);
  },
});
