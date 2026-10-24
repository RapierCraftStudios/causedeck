// `system.portfolio-alert.scan` (#665, #498 part 5, D-048 B2B): once a day, raise exception alerts
// (new adverse order, missed date) for each institution workspace with tracked cases
// (`scanPortfolioAlerts`). The job has no workspace and the tenant tables are under FORCE RLS, so it
// lists the target workspaces (ids only) through the owner-defined `app_portfolio_alert_targets`
// function, then scans each one inside its own workspace scope. One workspace failing is logged
// (id and error name only) and does not stop the others.
import { db as rootDb, type Queryable } from '@causedeck/db';
import type { DeliveryJob } from '@causedeck/notifications';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { scanPortfolioAlerts, type PortfolioAlertReport } from '../../portfolio/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';
import { getProducer } from '../producer.ts';

import { deliveryKey, notificationDeliverSchema } from './notification-deliver.ts';

export interface PortfolioAlertScanDeps {
  db?: Queryable;
  now?: () => Date;
  enqueueDelivery?: (job: DeliveryJob) => Promise<unknown>;
}

export interface PortfolioAlertScanReport extends PortfolioAlertReport {
  workspaces: number;
  failed: number;
}

/** Send one `notification.deliver` job as the registry's `enqueue` does (the registry imports this file). */
async function enqueueDelivery(job: DeliveryJob): Promise<unknown> {
  const data = notificationDeliverSchema.parse(job);
  const sender = await getProducer();
  return sender.send('notification.deliver', data, {
    singletonKey: deliveryKey(data),
    group: { id: data.workspaceId },
  });
}

/** The job body. Exported for tests. */
export async function runPortfolioAlertScan(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: PortfolioAlertScanDeps = {},
): Promise<PortfolioAlertScanReport> {
  const db = deps.db ?? rootDb;
  const rows = await ctx.db.execute<{ workspace_id: string }>(
    sql`select workspace_id::text from app_portfolio_alert_targets()`,
  );
  const report: PortfolioAlertScanReport = {
    workspaces: rows.length,
    adverse: 0,
    missed: 0,
    notified: 0,
    failed: 0,
  };
  for (const row of rows) {
    try {
      const done = await scanPortfolioAlerts(
        {
          db,
          enqueueDelivery: deps.enqueueDelivery ?? enqueueDelivery,
          ...(deps.now === undefined ? {} : { now: deps.now }),
        },
        row.workspace_id,
      );
      report.adverse += done.adverse;
      report.missed += done.missed;
      report.notified += done.notified;
    } catch (error) {
      report.failed += 1;
      ctx.log.warn(
        { workspaceId: row.workspace_id, error: error instanceof Error ? error.name : 'error' },
        'portfolio alert scan failed for workspace',
      );
    }
  }
  ctx.log.info({ ...report }, 'portfolio alert scan done');
  return report;
}

export const portfolioAlertScan = defineJob({
  name: 'system.portfolio-alert.scan',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'portfolio-alert-scan', policy: 'stately' },
  // Daily 06:00 IST, after the status poll has had the night to refresh the cases.
  schedule: { cron: '0 6 * * *', payload: {} },
  timeoutSec: 1800,
  handler: async (ctx) => {
    await runPortfolioAlertScan(ctx);
  },
});
