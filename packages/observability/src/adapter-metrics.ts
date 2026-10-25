// Court-adapter health metrics (monitoring, #102): feed the Adapters dashboard, the staleness
// alerts and the public status page. Attributes are the adapter id only, never matter data.
import type { Meter } from '@opentelemetry/api';

import { meter } from './otel.ts';

export const ADAPTER_METRICS = {
  parseSuccessRatio: 'adapter_parse_success_ratio',
  lastSuccessTimestamp: 'adapter_last_success_timestamp',
} as const;

interface AdapterState {
  ratio?: number;
  lastSuccessSeconds?: number;
}

const state = new Map<string, AdapterState>();
let registered: Meter | undefined;

function ensureRegistered(): void {
  const current = meter();
  if (registered === current) return;
  registered = current;
  current
    .createObservableGauge(ADAPTER_METRICS.parseSuccessRatio, {
      description: 'Share of the latest adapter fetches that parsed (0..1)',
    })
    .addCallback((result) => {
      for (const [adapter, s] of state) {
        if (s.ratio !== undefined) result.observe(s.ratio, { adapter });
      }
    });
  current
    .createObservableGauge(ADAPTER_METRICS.lastSuccessTimestamp, {
      description: 'Unix time (seconds) of the last successful adapter fetch',
      unit: 's',
    })
    .addCallback((result) => {
      for (const [adapter, s] of state) {
        if (s.lastSuccessSeconds !== undefined) result.observe(s.lastSuccessSeconds, { adapter });
      }
    });
}

/** Record one adapter run: `parsed` of `total` items parsed; a clean run stamps the success time. */
export function recordAdapterRun(
  adapter: string,
  run: { parsed: number; total: number; at?: Date },
): void {
  ensureRegistered();
  const entry = state.get(adapter) ?? {};
  entry.ratio = run.total === 0 ? 1 : Math.min(1, Math.max(0, run.parsed / run.total));
  if (run.parsed > 0 || run.total === 0) {
    entry.lastSuccessSeconds = Math.floor((run.at ?? new Date()).getTime() / 1000);
  }
  state.set(adapter, entry);
}

/** Test hook. */
export function resetAdapterMetrics(): void {
  state.clear();
  registered = undefined;
}
