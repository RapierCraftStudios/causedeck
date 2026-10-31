// `system.captcha-bulk.tick` (#1078, #492; dark behind `captcha.bulk` and `KILL_CAPTCHA_BULK`):
// every minute it feeds the bulk captcha scheduler from the registry and runs one scheduler tick.
// The scheduler lives in `@causedeck/fetch` and keeps its queue, per-host budgets and backoff in
// memory, so one instance is built on the first tick and reused. Feeding is the cleared sources
// only (`captcha_bulk_cleared` plus an approval reference, not killed), one job per source at its
// base URL at `launch` priority; the scheduler re-checks the gate on every dispatch anyway. Pages
// are read through the governed fetcher; an eCourts captcha challenge is answered through the
// solver chain (local OCR, then the paid tier inside its daily cap per host), the paid spend lands
// in `fetch_log` (tier `captcha`) for the per-court cost on Data Ops, and block, error and backoff
// alerts go to the data-ops notifier. The job has no workspace. Only counts are logged. Nothing
// reaches a court unless the worker wires a fetcher (`setCaptchaBulkWiring`), the flag is on, and a
// source row carries counsel's clearance and approval reference.
import { killSwitch, serverEnv } from '@causedeck/config/env';
import { schema, type Queryable } from '@causedeck/db';
import { FLAGS, resolveFlag } from '@causedeck/flags';
import {
  createBulkScheduler,
  createLocalSolver,
  createMockOcrEngine,
  createPaidSolver,
  createSolverChain,
  DEFAULT_PAID_COST_PER_SOLVE_DOLLARS,
  KILL_CAPTCHA_BULK,
  killSwitchesFromMap,
  pageSourceFromFetcher,
  withEcourtsCaptcha,
  type BulkAlertSink,
  type BulkJob,
  type BulkKillSwitches,
  type BulkSchedulerConfig,
  type EcourtsChallengeIo,
  type EcourtsSolveEvent,
  type FetchRegistry,
  type Fetcher,
  type OcrEngine,
  type PaidSolverClient,
  type TickReport,
} from '@causedeck/fetch';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  createAlertRouter,
  createBulkAlertSink,
  type AlertNotifier,
} from '../../data-ops/index.ts';
import { policyFor, recordFetchLog } from '../../sources/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

import { notifierFromEnv } from './data-ops-evaluate.ts';

export const CAPTCHA_BULK_FLAG = 'captcha.bulk';
/** Every minute (cron is evaluated in `Asia/Kolkata`); the scheduler's per-host budget paces the work. */
export const CAPTCHA_BULK_TICK_CRON = '* * * * *';
/** Paid solving spend allowed per host per UTC day unless the wiring says otherwise. */
export const DEFAULT_CAPTCHA_DAILY_CAP_DOLLARS = 1;

/** What the worker supplies. Everything defaults to a mock or to nothing: the dark build spends nothing. */
export interface CaptchaBulkWiring {
  /** The governed fetcher (core never builds one). */
  fetcher: (db: Queryable) => Fetcher;
  /** The in-house OCR engine; default is the mock engine, which reads nothing. */
  ocr?: OcrEngine;
  /** A paid solving service key and client; without a key the paid tier is the mock. */
  paidApiKey?: string;
  paidClient?: PaidSolverClient;
  /** The image read and form submit of a challenge; without it a challenge page is not answered. */
  io?: EcourtsChallengeIo;
  dailyCostCapDollars?: number;
  expectedPaidCostDollars?: number;
  config?: BulkSchedulerConfig;
  /** Extra jobs to feed besides the cleared sources' base URLs (what users track). */
  extraJobs?: (db: Queryable) => Promise<BulkJob[]>;
  /** Defaults to the parsed `KILL_*` switches of the environment. */
  kill?: BulkKillSwitches;
}

let wiring: CaptchaBulkWiring | null = null;

/** Wiring point: the worker passes the governed fetcher and ports; `null` unwires it (tests). */
export function setCaptchaBulkWiring(next: CaptchaBulkWiring | null): void {
  wiring = next;
  ticker = null;
}

/** The scheduler surface the job drives. */
export interface CaptchaBulkTicker {
  enqueue(job: BulkJob): 'queued' | 'duplicate' | 'queue_full';
  tick(): Promise<TickReport>;
}

export interface BuildTickerDeps {
  db: Queryable;
  wiring: CaptchaBulkWiring;
  alerts: BulkAlertSink;
  /** Defaults to the registry rows through `policyFor`. */
  registry?: FetchRegistry;
  /** Defaults to a `fetch_log` row. */
  recordSolve?: (event: EcourtsSolveEvent, at: Date) => Promise<void>;
  now?: () => Date;
}

/** Local solver first, paid within the cap; the eCourts page source over the governed fetcher. */
export function buildCaptchaBulkTicker(deps: BuildTickerDeps): CaptchaBulkTicker {
  const { db, wiring: w } = deps;
  const now = deps.now ?? (() => new Date());
  const chain = createSolverChain({
    local: createLocalSolver(w.ocr ?? createMockOcrEngine()),
    paid: createPaidSolver({ apiKey: w.paidApiKey, client: w.paidClient }),
    dailyCostCapDollars: w.dailyCostCapDollars ?? DEFAULT_CAPTCHA_DAILY_CAP_DOLLARS,
    expectedPaidCostDollars: w.expectedPaidCostDollars ?? DEFAULT_PAID_COST_PER_SOLVE_DOLLARS,
    now: () => now().getTime(),
  });
  const recordSolve =
    deps.recordSolve ??
    (async (event: EcourtsSolveEvent, at: Date) => {
      // Only paid solves cost anything; `fetch_log` carries them to the per-court cost on Data Ops.
      if (!event.solved || event.tier !== 'paid') return;
      await recordFetchLog(db, {
        sourceId: event.sourceId,
        urlHash: createHash('sha256').update(`captcha-solve:${event.host}`).digest('hex'),
        status: 200,
        tier: 'captcha',
        costDollars: event.costDollars,
        fetchedAt: at,
        advocateId: null,
      });
    });
  const pages = withEcourtsCaptcha(pageSourceFromFetcher(w.fetcher(db)), {
    io: w.io,
    chain,
    onSolve: (event) => recordSolve(event, now()),
  });
  return createBulkScheduler({
    registry: deps.registry ?? { policyFor: (id) => policyFor(id, { db }) },
    pages,
    clock: { now },
    kill: w.kill ?? killSwitchesFromMap(() => serverEnv().killSwitches),
    alerts: deps.alerts,
    ...(w.config === undefined ? {} : { config: w.config }),
  });
}

let ticker: CaptchaBulkTicker | null = null;
/** The notifier of the job now running; the long-lived scheduler's alert sink reads it. */
let currentNotifier: AlertNotifier = createAlertRouter([]);

/** Sources counsel cleared for bulk captcha solving, with an approval reference, and not killed. */
export async function listBulkFeed(db: Queryable): Promise<BulkJob[]> {
  const rows = await db
    .select({
      id: schema.source.id,
      baseUrl: schema.source.baseUrl,
      ref: schema.source.captchaBulkApprovalRef,
    })
    .from(schema.source)
    .where(
      and(
        eq(schema.source.captchaBulkCleared, true),
        isNotNull(schema.source.captchaBulkApprovalRef),
        isNotNull(schema.source.clearedAt),
        eq(schema.source.killSwitch, false),
        ne(schema.source.captchaBulkApprovalRef, ''),
      ),
    );
  return rows.map((r) => ({ sourceId: r.id, url: r.baseUrl, priority: 'launch' as const }));
}

/** The global `captcha.bulk` flag: its kill switch, then the global row (no workspace scope). */
export async function captchaBulkFlagOn(db: Queryable): Promise<boolean> {
  if (killSwitch(KILL_CAPTCHA_BULK, serverEnv())) return false;
  const [row] = await db
    .select({ enabled: schema.featureFlag.enabled, legalAckBy: schema.featureFlag.legalAckBy })
    .from(schema.featureFlag)
    .where(eq(schema.featureFlag.key, CAPTCHA_BULK_FLAG));
  return resolveFlag(FLAGS[CAPTCHA_BULK_FLAG], {
    killed: false,
    global: row === undefined ? undefined : { enabled: row.enabled, legalAckBy: row.legalAckBy },
  });
}

export interface CaptchaBulkTickReport {
  /** The flag was on and a fetcher was wired. */
  ran: boolean;
  fed: number;
  offPeak: boolean;
  pending: number;
  /** Jobs per disposition (`fetched`, `cached`, `blocked`, `denied_gate`, ...). */
  dispositions: Record<string, number>;
}

export interface CaptchaBulkTickDeps {
  flagEnabled?: () => Promise<boolean>;
  feed?: (db: Queryable) => Promise<BulkJob[]>;
  ticker?: CaptchaBulkTicker;
  notifier?: AlertNotifier;
}

/** Feed and tick once. Exported for tests. */
export async function runCaptchaBulkTick(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: CaptchaBulkTickDeps = {},
): Promise<CaptchaBulkTickReport> {
  const idle: CaptchaBulkTickReport = {
    ran: false,
    fed: 0,
    offPeak: false,
    pending: 0,
    dispositions: {},
  };
  const on = await (deps.flagEnabled ?? (() => captchaBulkFlagOn(ctx.db)))();
  if (!on) {
    ctx.log.info({ ran: false }, 'captcha bulk tick skipped: flag off');
    return idle;
  }
  currentNotifier = deps.notifier ?? notifierFromEnv(ctx.log);
  let active = deps.ticker ?? ticker;
  if (active === null) {
    if (wiring === null) {
      ctx.log.warn({}, 'captcha bulk tick skipped: no fetcher wired (setCaptchaBulkWiring)');
      return idle;
    }
    active = buildCaptchaBulkTicker({
      db: ctx.db,
      wiring,
      alerts: createBulkAlertSink({ notifier: () => currentNotifier, db: ctx.db }),
    });
    ticker = active;
  }
  const jobs = [
    ...(await (deps.feed ?? listBulkFeed)(ctx.db)),
    ...((await wiring?.extraJobs?.(ctx.db)) ?? []),
  ];
  let fed = 0;
  for (const job of jobs) if (active.enqueue(job) === 'queued') fed += 1;
  const tick = await active.tick();
  const dispositions: Record<string, number> = {};
  for (const j of tick.jobs) dispositions[j.disposition] = (dispositions[j.disposition] ?? 0) + 1;
  const report = { ran: true, fed, offPeak: tick.offPeak, pending: tick.pending, dispositions };
  ctx.log.info({ ...report }, 'captcha bulk tick');
  return report;
}

export const captchaBulkTick = defineJob({
  name: 'system.captcha-bulk.tick',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'captcha-bulk-tick', policy: 'stately' },
  schedule: { cron: CAPTCHA_BULK_TICK_CRON, payload: {} },
  handler: async (ctx) => {
    await runCaptchaBulkTick(ctx);
  },
});
