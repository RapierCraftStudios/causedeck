// Trend and trigger logic for the nightly perf run (#105): p95 regression against the previous
// run, and the summary against the Stage A to B triggers.
import { BUDGETS, STAGE_B_TRIGGERS } from './thresholds.ts';

/** p95 per route group, ms. */
export type P95Summary = Record<string, number>;

export interface Regression {
  route: string;
  previous: number;
  current: number;
  change: number;
}

/** Routes whose p95 grew by more than `fraction` (default 15%) over the previous run. */
export function compareP95(
  previous: P95Summary,
  current: P95Summary,
  fraction: number = BUDGETS.regressionFraction,
): Regression[] {
  const regressions: Regression[] = [];
  for (const [route, now] of Object.entries(current)) {
    const before = previous[route];
    if (before === undefined || before <= 0) continue;
    const change = (now - before) / before;
    if (change > fraction) regressions.push({ route, previous: before, current: now, change });
  }
  return regressions.sort((a, b) => b.change - a.change);
}

/** The markdown body of the auto-opened issue. */
export function regressionReport(regressions: Regression[]): string {
  const rows = regressions.map(
    (r) =>
      `| ${r.route} | ${r.previous.toFixed(0)} | ${r.current.toFixed(0)} | +${(r.change * 100).toFixed(1)}% |`,
  );
  return [
    `p95 grew by more than ${String(BUDGETS.regressionFraction * 100)}% against the previous nightly run.`,
    '',
    '| Route group | Previous p95 (ms) | Current p95 (ms) | Change |',
    '| --- | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}

/** Resource samples taken during the soak. */
export interface ResourceSample {
  dbCpuPercent: number;
  dbConnections: number;
  queueLagSeconds: number;
}

export interface StageBSummary {
  p95Ms: number;
  dbCpuPercent: number;
  dbConnections: number;
  queueLagSeconds: number;
  seats: number;
  breached: string[];
}

/** Peak of the samples against the Stage B triggers (spike §3.2). Any breach recommends Stage B. */
export function stageBSummary(
  p95Ms: number,
  samples: ResourceSample[],
  seats: number,
): StageBSummary {
  const peak = (pick: (s: ResourceSample) => number) => Math.max(0, ...samples.map(pick));
  const dbCpuPercent = peak((s) => s.dbCpuPercent);
  const breached: string[] = [];
  if (p95Ms > STAGE_B_TRIGGERS.p95Ms) breached.push('p95');
  if (dbCpuPercent > STAGE_B_TRIGGERS.dbCpuPercent) breached.push('db_cpu');
  if (seats > STAGE_B_TRIGGERS.seats) breached.push('seats');
  return {
    p95Ms,
    dbCpuPercent,
    dbConnections: peak((s) => s.dbConnections),
    queueLagSeconds: peak((s) => s.queueLagSeconds),
    seats,
    breached,
  };
}

/** Route group p95 values (ms) out of a k6 `--summary-export` / handleSummary JSON. */
export function p95FromK6Summary(summary: {
  metrics?: Record<string, Record<string, number> & { values?: Record<string, number> }>;
}): P95Summary {
  const result: P95Summary = {};
  for (const [name, metric] of Object.entries(summary.metrics ?? {})) {
    const match = /^http_req_duration\{group:(\w+)\}$/.exec(name);
    const value = metric.values?.['p(95)'] ?? metric['p(95)'];
    if (match?.[1] && typeof value === 'number') result[match[1]] = value;
  }
  return result;
}
