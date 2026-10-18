import { metrics, trace } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withRequestLogging } from '../http.ts';
import {
  initTelemetry,
  METRICS,
  recordDbQueryDuration,
  safeAttributes,
  samplerFor,
  withSpan,
  type Telemetry,
} from '../otel.ts';
import { captureLogger } from './helpers.ts';

let telemetry: Telemetry | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
  vi.restoreAllMocks();
});

describe('initTelemetry', () => {
  it('is a silent no-op without an OTLP endpoint', async () => {
    const error = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');

    telemetry = initTelemetry({ service: 'test' });
    const result = await withSpan('noop', () => 'value');

    expect(telemetry.enabled).toBe(false);
    expect(result).toBe('value');
    expect(trace.getActiveSpan()).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('exports a request trace with a child DB span', async () => {
    const exporter = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60_000,
    });
    telemetry = initTelemetry({ service: 'web', spanExporter: exporter, metricReader: reader });
    const { logger } = captureLogger();

    const handler = withRequestLogging(
      logger,
      async () => {
        await withSpan(
          'db.query',
          async () => {
            await Promise.resolve();
            recordDbQueryDuration(3, { 'db.operation': 'select' });
          },
          { attributes: { 'db.system': 'postgresql', 'db.statement.text': 'secret text' } },
        );
        return new Response('ok');
      },
      { route: '/matters/:id' },
    );
    await handler(new Request('http://localhost/matters/42?token=abc'));

    const spans = exporter.getFinishedSpans();
    const server = spans.find((s) => s.name === 'GET /matters/:id');
    const db = spans.find((s) => s.name === 'db.query');
    expect(server).toBeDefined();
    expect(db).toBeDefined();
    expect(db?.spanContext().traceId).toBe(server?.spanContext().traceId);
    expect(db?.parentSpanContext?.spanId).toBe(server?.spanContext().spanId);
    expect(server?.attributes['http.response.status_code']).toBe(200);
    expect(server?.resource.attributes['service.name']).toBe('web');
    expect(db?.attributes).not.toHaveProperty('db.statement.text');
    expect(JSON.stringify(spans.map((s) => s.attributes))).not.toContain('token=abc');

    await reader.forceFlush();
    const names = metricExporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics.map((m) => m.descriptor.name)));
    expect(names).toEqual(
      expect.arrayContaining([METRICS.httpServerDuration, METRICS.dbQueryDuration]),
    );
  });

  it('records only the exception type and scrubbed message on failure', async () => {
    const exporter = new InMemorySpanExporter();
    telemetry = initTelemetry({ service: 'test', spanExporter: exporter });

    await expect(
      withSpan('fails', () => Promise.reject(new Error('bad password=hunter2'))),
    ).rejects.toThrow();

    const [span] = exporter.getFinishedSpans();
    expect(span?.attributes['exception.type']).toBe('Error');
    expect(JSON.stringify(span?.status)).not.toContain('hunter2');
    expect(span?.events).toHaveLength(0);
  });

  it('is idempotent', () => {
    const exporter = new InMemorySpanExporter();
    telemetry = initTelemetry({ service: 'a', spanExporter: exporter });

    expect(initTelemetry({ service: 'b' })).toBe(telemetry);
  });

  it('samples 10% in production and everything elsewhere', () => {
    expect(samplerFor('production').toString()).toContain('0.1');
    expect(samplerFor('development').toString()).toContain('AlwaysOn');
  });

  it('drops content and secret attributes', () => {
    expect(
      safeAttributes({
        'matter.content': 'x',
        text: 'y',
        'auth.token': 'z',
        ok: 1,
        url: 'a?token=b',
      }),
    ).toEqual({ ok: 1, url: 'a?token=[REDACTED]' });
  });

  it('leaves the global meter as a no-op when disabled', () => {
    telemetry = initTelemetry({ service: 'test' });
    expect(() => {
      metrics.getMeter('x').createHistogram('h').record(1);
    }).not.toThrow();
  });
});
