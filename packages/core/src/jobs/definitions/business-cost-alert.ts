// `system.business.cost-alert` (#519, D-049): every morning (IST) read the business snapshot, work
// out each plan's cost to serve per active user and email the founders when a plan is over
// `BUSINESS_COST_PER_USER_ALERT_PAISE`. The job has no workspace, so `once()` does not apply; the
// singleton key and the schedule give one run per IST day, and the subject carries the day. Nothing
// is sent when no founder is configured or no plan is over the threshold. Aggregates only.
import { serverEnv } from '@causedeck/config/env';
import type { EmailTransport } from '@causedeck/notifications/email';
import { z } from 'zod';

import {
  businessConfigFromEnv,
  buildBusinessReport,
  evaluateCostThresholds,
  readBusinessSnapshot,
  renderCostAlert,
  type BusinessConfig,
  type BusinessSnapshot,
} from '../../business/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

import { notificationJobDeps } from './notification-deliver.ts';

export interface BusinessJobDeps {
  now?: () => Date;
  snapshot?: () => Promise<BusinessSnapshot>;
  email?: EmailTransport;
  founders?: readonly string[];
  config?: BusinessConfig;
}

export interface BusinessCostAlertReport {
  breaches: number;
  sent: number;
}

/** The founders from `BUSINESS_FOUNDER_EMAILS` (comma-separated), trimmed. */
export function founderEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e !== '');
}

/** The IST calendar day of `at`, `YYYY-MM-DD`. */
export function istDay(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** The config and founders: the injected ones, else the server env. */
export function resolveBusinessDeps(deps: BusinessJobDeps): {
  config: BusinessConfig;
  founders: readonly string[];
} {
  if (deps.config !== undefined && deps.founders !== undefined) {
    return { config: deps.config, founders: deps.founders };
  }
  const env = serverEnv();
  return {
    config: deps.config ?? businessConfigFromEnv(env),
    founders: deps.founders ?? founderEmails(env.BUSINESS_FOUNDER_EMAILS),
  };
}

/** Evaluate the thresholds and email the founders. Exported for tests. */
export async function runBusinessCostAlert(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: BusinessJobDeps = {},
): Promise<BusinessCostAlertReport> {
  const now = deps.now?.() ?? new Date();
  const { config, founders } = resolveBusinessDeps(deps);
  const snapshot = await (deps.snapshot?.() ?? readBusinessSnapshot(ctx.db, now));
  const breaches = evaluateCostThresholds(
    buildBusinessReport(snapshot, config),
    config.costAlertPaisePerUser,
  );
  const report: BusinessCostAlertReport = { breaches: breaches.length, sent: 0 };
  if (breaches.length === 0 || founders.length === 0) {
    ctx.log.info({ ...report, founders: founders.length }, 'business cost alert: nothing to send');
    return report;
  }

  const email = deps.email ?? notificationJobDeps(ctx.log).email;
  const message = renderCostAlert(breaches, istDay(now));
  for (const to of founders) {
    await email.send({ to, ...message, tags: { template: 'business.cost-alert' } });
    report.sent += 1;
  }
  ctx.log.info({ ...report }, 'business cost alert sent');
  return report;
}

export const businessCostAlert = defineJob({
  name: 'system.business.cost-alert',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'business-cost-alert', policy: 'stately' },
  // Daily at 08:00 IST.
  schedule: { cron: '0 8 * * *', payload: {} },
  handler: async (ctx) => {
    await runBusinessCostAlert(ctx);
  },
});
