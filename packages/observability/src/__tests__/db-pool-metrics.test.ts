import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it } from 'vitest';

import { DB_POOL_METRICS, registerDbPoolMetrics, resetDbPoolMetrics } from '../db-pool-metrics.ts';
import { initTelemetry, type Telemetry } from '../otel.ts';

let telemetry: Telemetry | undefined;

afterEach(async () => {
  resetDbPoolMetrics();
  await telemetry?.shutdown();
  telemetry = undefined;
  metrics.disable();
});

async function collect(probes: Parameters<typeof registerDbPoolMetrics>[0]) {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
  telemetry = initTelemetry({
    service: 'web',
    spanExporter: new InMemorySpanExporter(),
    metricReader: reader,
  });
  registerDbPoolMetrics(probes);
  await reader.forceFlush();
  return exporter.getMetrics().flatMap((m) => m.scopeMetrics.flatMap((s) => s.metrics));
}

describe('db pool metrics', () => {
  it('reports wait and idle-in-transaction signals per pool', async () => {
    const all = await collect({
      app: () =>
        Promise.resolve({
          waitSeconds: 0.42,
          connections: 10,
          active: 6,
          idleInTransaction: 2,
          idleInTransactionMaxSeconds: 4.5,
        }),
      auth: () =>
        Promise.resolve({
          waitSeconds: 0.004,
          connections: 3,
          active: 0,
          idleInTransaction: 0,
          idleInTransactionMaxSeconds: 0,
        }),
    });
    const point = (name: string, pool: string) =>
      all
        .find((m) => m.descriptor.name === name)
        ?.dataPoints.find((p) => (p.attributes as { pool?: string }).pool === pool)?.value;

    expect(point(DB_POOL_METRICS.waitSeconds, 'app')).toBeCloseTo(0.42);
    expect(point(DB_POOL_METRICS.waitSeconds, 'auth')).toBeCloseTo(0.004);
    expect(point(DB_POOL_METRICS.idleInTransaction, 'app')).toBe(2);
    expect(point(DB_POOL_METRICS.idleInTransactionMaxSeconds, 'app')).toBe(4.5);
    expect(point(DB_POOL_METRICS.connections, 'app')).toBe(10);
  });

  it('counts a failed probe (connect timeout) and still reports the other pool', async () => {
    const all = await collect({
      app: () => Promise.reject(new Error('connect timeout')),
      auth: () =>
        Promise.resolve({
          waitSeconds: 0.01,
          connections: 1,
          active: 0,
          idleInTransaction: 0,
          idleInTransactionMaxSeconds: 0,
        }),
    });
    const errors = all.find((m) => m.descriptor.name === DB_POOL_METRICS.probeErrors);
    expect(errors?.dataPoints[0]?.value).toBe(1);
    expect(errors?.dataPoints[0]?.attributes).toEqual({ pool: 'app' });
    const wait = all.find((m) => m.descriptor.name === DB_POOL_METRICS.waitSeconds);
    expect(wait?.dataPoints.map((p) => p.attributes)).toEqual([{ pool: 'auth' }]);
  });
});
