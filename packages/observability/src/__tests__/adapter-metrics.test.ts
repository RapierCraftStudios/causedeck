import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it } from 'vitest';

import { ADAPTER_METRICS, recordAdapterRun, resetAdapterMetrics } from '../adapter-metrics.ts';
import { initTelemetry, type Telemetry } from '../otel.ts';

let telemetry: Telemetry | undefined;

afterEach(async () => {
  resetAdapterMetrics();
  await telemetry?.shutdown();
  telemetry = undefined;
  metrics.disable();
});

describe('adapter metrics', () => {
  it('exposes parse ratio and last success timestamp per adapter', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
    telemetry = initTelemetry({
      service: 'worker',
      spanExporter: new InMemorySpanExporter(),
      metricReader: reader,
    });

    recordAdapterRun('madras-hc', { parsed: 9, total: 10, at: new Date('2026-01-01T00:00:00Z') });
    await reader.forceFlush();

    const all = exporter.getMetrics().flatMap((m) => m.scopeMetrics.flatMap((s) => s.metrics));
    const ratio = all.find((m) => m.descriptor.name === ADAPTER_METRICS.parseSuccessRatio);
    const last = all.find((m) => m.descriptor.name === ADAPTER_METRICS.lastSuccessTimestamp);
    expect(ratio?.dataPoints[0]?.value).toBeCloseTo(0.9);
    expect(ratio?.dataPoints[0]?.attributes).toEqual({ adapter: 'madras-hc' });
    expect(last?.dataPoints[0]?.value).toBe(1767225600);
  });
});
