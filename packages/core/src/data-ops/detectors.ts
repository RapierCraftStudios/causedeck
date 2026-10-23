// Data-ops detectors (#515, D-049): pure functions from a source's metrics to a verdict. Each
// returns `breached: false` when it has no SLO to hold the source to or too little data to judge,
// so a quiet source never alerts and a recovered one resolves. Inputs are counts, ratios, dollars
// and timestamps read from `fetch_log` and `source_parse_run`; no fetched content is involved.
import { schema } from '@causedeck/db';

export const DATA_OPS_ALERT_TYPES = schema.DATA_OPS_ALERT_TYPES;
export type DataOpsAlertType = schema.DataOpsAlertType;

/** Thresholds with no per-source column; the SLO columns on `source` override the rest. */
export const DETECTOR_DEFAULTS = Object.freeze({
  /** Calls in the error window before the success rate is judged. */
  minCalls: 5,
  /** Parsed records in a window before the conflict rate is judged. */
  minParsed: 20,
  /** Conflicts over parsed records above this fire the conflict-rate detector. */
  conflictRateCeiling: 0.1,
  /** Last-24h cost above this many times the 7-day daily baseline is an anomaly... */
  costFactor: 3,
  /** ...and only above this absolute spend, so a $0.001 baseline does not page. */
  costMinDollars: 0.5,
});

/** Window of `fetch_log` rows the error-rate and block detectors read. */
export const ERROR_WINDOW_MINUTES = 60;

export interface SourceSlo {
  freshnessMinutes: number | null;
  successRate: number | null;
  parseYieldFloor: number | null;
}

export interface SourceMetrics {
  sourceId: string;
  now: Date;
  slo: SourceSlo;
  /** The last fetch with a 2xx status, or null if there never was one. */
  lastSuccessAt: Date | null;
  /** Calls in the last `ERROR_WINDOW_MINUTES`; failures exclude blocks. */
  calls: { total: number; failures: number; blocks: number };
  /** True while the source is inside a block backoff. */
  backedOff: boolean;
  /** The most recent parse run, or null. */
  latestParse: { parserVersion: string; expected: number; parsed: number } | null;
  /** Spend in the last 24 hours and the mean daily spend of the 7 days before. */
  cost: { last24h: number; baselineDaily: number };
  /** Parsed records and conflicts in the last 24 hours. */
  conflicts: { parsed: number; conflicts: number };
}

export interface Detection {
  type: DataOpsAlertType;
  sourceId: string;
  breached: boolean;
  /** Numbers only; stored on the alert and sent to the channels. */
  detail: string;
  /** The parser version the verdict is about (parse yield), for the quarantine response. */
  parserVersion?: string;
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

export function detectFreshness(m: SourceMetrics): Detection {
  const base = { type: 'freshness', sourceId: m.sourceId } as const;
  const limit = m.slo.freshnessMinutes;
  if (limit === null) return { ...base, breached: false, detail: 'no freshness SLO' };
  if (m.lastSuccessAt === null) {
    return { ...base, breached: true, detail: `no successful fetch; SLO ${limit} min` };
  }
  const ageMinutes = Math.floor((m.now.getTime() - m.lastSuccessAt.getTime()) / 60_000);
  return {
    ...base,
    breached: ageMinutes > limit,
    detail: `last success ${ageMinutes} min ago; SLO ${limit} min`,
  };
}

export function detectErrorRate(m: SourceMetrics): Detection {
  const base = { type: 'error_rate', sourceId: m.sourceId } as const;
  const target = m.slo.successRate;
  const { total, failures, blocks } = m.calls;
  if (target === null || total < DETECTOR_DEFAULTS.minCalls) {
    return { ...base, breached: false, detail: 'no success-rate SLO or too few calls' };
  }
  // Blocks are the block detector's; they count against the rate here too, a blocked call failed.
  const rate = (total - failures - blocks) / total;
  return {
    ...base,
    breached: rate < target,
    detail: `success ${pct(rate)} over ${total} calls; SLO ${pct(target)}`,
  };
}

export function detectBlockSignature(m: SourceMetrics): Detection {
  const base = { type: 'block_signature', sourceId: m.sourceId } as const;
  const breached = m.calls.blocks > 0 || m.backedOff;
  return {
    ...base,
    breached,
    detail: `${m.calls.blocks} blocked call(s) in ${ERROR_WINDOW_MINUTES} min${m.backedOff ? '; backing off' : ''}`,
  };
}

export function detectParseYield(m: SourceMetrics): Detection {
  const base = { type: 'parse_yield', sourceId: m.sourceId } as const;
  const floor = m.slo.parseYieldFloor;
  const run = m.latestParse;
  if (floor === null || run === null || run.expected === 0) {
    return { ...base, breached: false, detail: 'no parse-yield SLO or no parse run' };
  }
  const yieldRate = run.parsed / run.expected;
  return {
    ...base,
    breached: yieldRate < floor,
    detail: `yield ${pct(yieldRate)} (${run.parsed}/${run.expected}) on parser ${run.parserVersion}; floor ${pct(floor)}`,
    parserVersion: run.parserVersion,
  };
}

export function detectCostAnomaly(m: SourceMetrics): Detection {
  const base = { type: 'cost_anomaly', sourceId: m.sourceId } as const;
  const { last24h, baselineDaily } = m.cost;
  const limit = Math.max(
    baselineDaily * DETECTOR_DEFAULTS.costFactor,
    DETECTOR_DEFAULTS.costMinDollars,
  );
  return {
    ...base,
    breached: last24h > limit,
    detail: `$${last24h.toFixed(4)} in 24 h against a 7-day daily baseline of $${baselineDaily.toFixed(4)}`,
  };
}

export function detectConflictRate(m: SourceMetrics): Detection {
  const base = { type: 'conflict_rate', sourceId: m.sourceId } as const;
  const { parsed, conflicts } = m.conflicts;
  if (parsed < DETECTOR_DEFAULTS.minParsed) {
    return { ...base, breached: false, detail: 'too few parsed records' };
  }
  const rate = conflicts / parsed;
  return {
    ...base,
    breached: rate > DETECTOR_DEFAULTS.conflictRateCeiling,
    detail: `${conflicts} conflicts in ${parsed} records (${pct(rate)}); ceiling ${pct(DETECTOR_DEFAULTS.conflictRateCeiling)}`,
  };
}

/** Every detector against one source's metrics, always one verdict per alert type. */
export function runDetectors(m: SourceMetrics): Detection[] {
  return [
    detectFreshness(m),
    detectErrorRate(m),
    detectBlockSignature(m),
    detectParseYield(m),
    detectCostAnomaly(m),
    detectConflictRate(m),
  ];
}

/** `<type>:<sourceId>`: the alert dedup key. */
export function dedupKey(type: DataOpsAlertType, sourceId: string): string {
  return `${type}:${sourceId}`;
}
