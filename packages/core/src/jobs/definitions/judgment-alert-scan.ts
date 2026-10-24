// `system.judgment-alert.scan` (#497, D-048): once a day after the corpus poll, match the judgments
// ingested since the last runs to each workspace's confirmed issue tags and alert the advocates
// (`scanJudgments`). The job has no workspace and the tenant tables are under FORCE RLS, so it
// lists the target workspaces (ids only) through the owner-defined `app_judgment_alert_targets`
// function, then scans each one inside its own workspace scope. One workspace failing is logged
// (id and error name only) and does not stop the others.
import { db as rootDb, type Queryable } from '@causedeck/db';
import type { DeliveryJob } from '@causedeck/notifications';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { scanJudgments, type ScanReport } from '../../research/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';
import { getProducer } from '../producer.ts';

import { deliveryKey, notificationDeliverSchema } from './notification-deliver.ts';

export interface JudgmentAlertScanDeps {
  db?: Queryable;
  now?: () => Date;
  enqueueDelivery?: (job: DeliveryJob) => Promise<unknown>;
}

export interface JudgmentAlertScanReport extends ScanReport {
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
export async function runJudgmentAlertScan(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: JudgmentAlertScanDeps = {},
): Promise<JudgmentAlertScanReport> {
  const db = deps.db ?? rootDb;
  const rows = await ctx.db.execute<{ workspace_id: string }>(
    sql`select workspace_id::text from app_judgment_alert_targets()`,
  );
  const report: JudgmentAlertScanReport = {
    workspaces: rows.length,
    judgments: 0,
    alerts: 0,
    notified: 0,
    failed: 0,
  };
  for (const row of rows) {
    try {
      const done = await scanJudgments(
        {
          db,
          enqueueDelivery: deps.enqueueDelivery ?? enqueueDelivery,
          ...(deps.now === undefined ? {} : { now: deps.now }),
        },
        row.workspace_id,
      );
      report.judgments += done.judgments;
      report.alerts += done.alerts;
      report.notified += done.notified;
    } catch (error) {
      report.failed += 1;
      ctx.log.warn(
        { workspaceId: row.workspace_id, error: error instanceof Error ? error.name : 'error' },
        'judgment alert scan failed for workspace',
      );
    }
  }
  ctx.log.info({ ...report }, 'judgment alert scan done');
  return report;
}

export const judgmentAlertScan = defineJob({
  name: 'system.judgment-alert.scan',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'judgment-alert-scan', policy: 'stately' },
  // Daily 05:30 IST, after `system.corpus.poll` (05:00).
  schedule: { cron: '30 5 * * *', payload: {} },
  timeoutSec: 1800,
  handler: async (ctx) => {
    await runJudgmentAlertScan(ctx);
  },
});
