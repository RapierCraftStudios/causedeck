// Latency percentiles for the pipeline p95 benchmark (#561). Nearest-rank, so a reported
// percentile is always a latency that was actually observed.

export interface LatencySummary {
  count: number;
  minMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

/** Nearest-rank percentile (`p` in 0-100) of `values`; NaN for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] ?? Number.NaN;
}

export function summarise(values: readonly number[]): LatencySummary {
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    minMs: values.length === 0 ? Number.NaN : Math.min(...values),
    meanMs: values.length === 0 ? Number.NaN : sum / values.length,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    p99Ms: percentile(values, 99),
    maxMs: values.length === 0 ? Number.NaN : Math.max(...values),
  };
}
