// `system.data-ops.evaluate` (#515, D-049): every 15 minutes, read each source's SLOs, its recent
// `fetch_log` rows and its parse runs, run the detectors, reconcile the alert ledger (open once,
// refresh, auto-resolve) and apply the block and parse-yield responses. Reads counts, ratios and
// dollars only; no fetched content exists in the tables it reads.
import { serverEnv } from '@causedeck/config/env';
import { schema, type Queryable } from '@causedeck/db';
import { postWebhook } from '@causedeck/fetch';
import { createEmailTransport } from '@causedeck/notifications/email';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  ERROR_WINDOW_MINUTES,
  applyResponses,
  createAlertRouter,
  createEmailChannel,
  createLogChannel,
  createSlackChannel,
  reconcileAlerts,
  runDetectors,
  type AlertChannel,
  type AlertNotifier,
  type SourceMetrics,
} from '../../data-ops/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

const { fetchLog, source, sourceHealth, sourceParseRun } = schema;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const num = (value: string | null): number | null => (value === null ? null : Number(value));

/** One source's metrics at `now`, read from `fetch_log`, `source_parse_run` and `source_health`. */
export async function readSourceMetrics(
  db: Queryable,
  row: typeof source.$inferSelect,
  now: Date,
): Promise<SourceMetrics> {
  const sourceId = row.id;
  const windowStart = new Date(now.getTime() - ERROR_WINDOW_MINUTES * MINUTE_MS);
  const dayStart = new Date(now.getTime() - DAY_MS);
  const weekStart = new Date(now.getTime() - 8 * DAY_MS);

  const [success] = await db
    .select({ at: sql<Date | null>`max(${fetchLog.fetchedAt})` })
    .from(fetchLog)
    .where(and(eq(fetchLog.sourceId, sourceId), sql`${fetchLog.status} between 200 and 299`));
  const [calls] = await db
    .select({
      total: sql<number>`count(*)::int`,
      blocks: sql<number>`count(*) filter (where ${fetchLog.status} in (403, 429))::int`,
      failures: sql<number>`count(*) filter (where (${fetchLog.status} = 0 or ${fetchLog.status} >= 400) and ${fetchLog.status} not in (403, 429))::int`,
    })
    .from(fetchLog)
    .where(and(eq(fetchLog.sourceId, sourceId), gte(fetchLog.fetchedAt, windowStart)));
  const [cost] = await db
    .select({
      last24h: sql<string>`coalesce(sum(${fetchLog.costDollars}) filter (where ${fetchLog.fetchedAt} >= ${dayStart}), 0)`,
      before: sql<string>`coalesce(sum(${fetchLog.costDollars}) filter (where ${fetchLog.fetchedAt} < ${dayStart}), 0)`,
    })
    .from(fetchLog)
    .where(and(eq(fetchLog.sourceId, sourceId), gte(fetchLog.fetchedAt, weekStart)));
  const [latest] = await db
    .select()
    .from(sourceParseRun)
    .where(eq(sourceParseRun.sourceId, sourceId))
    .orderBy(desc(sourceParseRun.ranAt))
    .limit(1);
  const [conflicts] = await db
    .select({
      parsed: sql<number>`coalesce(sum(${sourceParseRun.parsed}), 0)::int`,
      conflicts: sql<number>`coalesce(sum(${sourceParseRun.conflicts}), 0)::int`,
    })
    .from(sourceParseRun)
    .where(and(eq(sourceParseRun.sourceId, sourceId), gte(sourceParseRun.ranAt, dayStart)));
  const [health] = await db.select().from(sourceHealth).where(eq(sourceHealth.sourceId, sourceId));

  return {
    sourceId,
    now,
    slo: {
      freshnessMinutes: row.sloFreshnessMinutes,
      successRate: num(row.sloSuccessRate),
      parseYieldFloor: num(row.sloParseYieldFloor),
    },
    lastSuccessAt: success?.at ? new Date(success.at) : null,
    calls: { total: calls?.total ?? 0, failures: calls?.failures ?? 0, blocks: calls?.blocks ?? 0 },
    backedOff: (health?.backoffUntil?.getTime() ?? 0) > now.getTime(),
    latestParse:
      latest === undefined
        ? null
        : { parserVersion: latest.parserVersion, expected: latest.expected, parsed: latest.parsed },
    cost: { last24h: Number(cost?.last24h ?? 0), baselineDaily: Number(cost?.before ?? 0) / 7 },
    conflicts: { parsed: conflicts?.parsed ?? 0, conflicts: conflicts?.conflicts ?? 0 },
  };
}

export interface DataOpsEvaluateReport {
  sources: number;
  opened: number;
  refreshed: number;
  resolved: number;
}

/** Evaluate every source in the registry. Exported for tests. */
export async function runDataOpsEvaluate(
  db: Queryable,
  notifier: AlertNotifier,
  now: Date,
): Promise<DataOpsEvaluateReport> {
  const sources = await db.select().from(source);
  const total: DataOpsEvaluateReport = {
    sources: sources.length,
    opened: 0,
    refreshed: 0,
    resolved: 0,
  };
  for (const row of sources) {
    const metrics = await readSourceMetrics(db, row, now);
    const detections = runDetectors(metrics);
    await applyResponses(db, metrics, detections, now);
    const report = await reconcileAlerts({ db, notifier, now }, detections);
    total.opened += report.opened;
    total.refreshed += report.refreshed;
    total.resolved += report.resolved;
  }
  return total;
}

/** Slack when a webhook is configured, email when a mailbox is, the log when neither. */
export function notifierFromEnv(log: JobContext['log']): AlertNotifier {
  const env = serverEnv();
  const channels: AlertChannel[] = [];
  const hook = env.DATA_OPS_SLACK_WEBHOOK_URL?.reveal();
  if (hook !== undefined)
    channels.push(createSlackChannel((payload) => postWebhook(hook, payload)));
  if (env.DATA_OPS_ALERT_EMAIL !== undefined) {
    const transport = createEmailTransport(env, log);
    channels.push(
      createEmailChannel(async ({ to, subject, text }) => {
        await transport.send({ to, subject, text, html: `<p>${text}</p>` });
      }, env.DATA_OPS_ALERT_EMAIL),
    );
  }
  if (channels.length === 0) channels.push(createLogChannel(log));
  return createAlertRouter(channels);
}

export interface DataOpsEvaluateDeps {
  notifier?: AlertNotifier;
  now?: () => Date;
}

export const systemDataOpsEvaluate = defineJob({
  name: 'system.data-ops.evaluate',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'data-ops-evaluate', policy: 'stately' },
  schedule: { cron: '*/15 * * * *', payload: {} },
  handler: async (ctx) => {
    const report = await runDataOpsEvaluate(ctx.db, notifierFromEnv(ctx.log), new Date());
    ctx.log.info({ ...report }, 'data-ops evaluated');
  },
});
