// OpenTelemetry (spike §1): traces and metrics with an optional OTLP exporter. Without an endpoint
// nothing is registered, so `@opentelemetry/api` stays a silent no-op.
import { serverEnv } from '@causedeck/config/env';
import {
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type AttributeValue,
  type Histogram,
  type Meter,
  type Span,
  type SpanKind,
  type Tracer,
} from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type IMetricReader,
} from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  AlwaysOnSampler,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
  type Sampler,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import { getRequestContext } from './context.ts';
import { runtimeInfo, type RuntimeInfo } from './logger.ts';
import { isContentKey, isSecretKey, scrubSecretsInString } from './redact.ts';

const INSTRUMENTATION_SCOPE = '@causedeck/observability';

/** Production head sampling ratio (spike §1). */
export const PROD_SAMPLE_RATIO = 0.1;

export interface InitTelemetryOptions {
  readonly service: string;
  /** Defaults to `OTEL_EXPORTER_OTLP_ENDPOINT`. Telemetry is a no-op when neither is set. */
  readonly endpoint?: string;
  /** Test hook: export spans here instead of OTLP (spans are exported synchronously). */
  readonly spanExporter?: SpanExporter;
  /** Test hook: collect metrics with this reader instead of OTLP. */
  readonly metricReader?: IMetricReader;
  readonly runtime?: Partial<RuntimeInfo>;
}

export interface Telemetry {
  readonly enabled: boolean;
  shutdown(): Promise<void>;
}

const disabled: Telemetry = { enabled: false, shutdown: () => Promise.resolve() };

let active: Telemetry | undefined;

function configuredEndpoint(): string | undefined {
  try {
    return serverEnv().OTEL_EXPORTER_OTLP_ENDPOINT;
  } catch {
    return undefined;
  }
}

export function samplerFor(env: RuntimeInfo['env']): Sampler {
  return env === 'production'
    ? new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(PROD_SAMPLE_RATIO) })
    : new AlwaysOnSampler();
}

/**
 * Start tracing and metrics once per process. Idempotent: later calls return the first result
 * until `shutdown()` is called.
 */
export function initTelemetry(options: InitTelemetryOptions): Telemetry {
  if (active !== undefined) return active;

  const endpoint = options.endpoint ?? configuredEndpoint();
  if (endpoint === undefined && options.spanExporter === undefined) {
    return disabled;
  }

  const runtime = { ...runtimeInfo(), ...options.runtime };
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: options.service,
    [ATTR_SERVICE_VERSION]: runtime.version,
    'deployment.environment.name': runtime.env,
  });
  const sampler = samplerFor(runtime.env);
  const reset = () => {
    active = undefined;
  };

  if (options.spanExporter !== undefined) {
    const tracerProvider = new NodeTracerProvider({
      resource,
      sampler,
      spanProcessors: [new SimpleSpanProcessor(options.spanExporter)],
    });
    tracerProvider.register();
    const meterProvider =
      options.metricReader === undefined
        ? undefined
        : new MeterProvider({ resource, readers: [options.metricReader] });
    if (meterProvider !== undefined) metrics.setGlobalMeterProvider(meterProvider);
    active = {
      enabled: true,
      shutdown: async () => {
        reset();
        await tracerProvider.shutdown();
        await meterProvider?.shutdown();
        trace.disable();
        metrics.disable();
      },
    };
    return active;
  }

  const base = (endpoint ?? '').replace(/\/+$/, '');
  const sdk = new NodeSDK({
    resource,
    sampler,
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    metricReaders: [
      options.metricReader ??
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
        }),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });
  sdk.start();
  active = {
    enabled: true,
    shutdown: async () => {
      reset();
      await sdk.shutdown();
    },
  };
  return active;
}

export function tracer(): Tracer {
  return trace.getTracer(INSTRUMENTATION_SCOPE);
}

export function meter(): Meter {
  return metrics.getMeter(INSTRUMENTATION_SCOPE);
}

export type SpanAttributeInput = Record<string, AttributeValue | null | undefined>;

/**
 * Attributes safe to put on a span: content and secret keys are dropped, strings are scrubbed of
 * embedded credentials and capped in length.
 */
export function safeAttributes(input: SpanAttributeInput | undefined): Attributes {
  const out: Attributes = {};
  if (input === undefined) return out;
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    const leaf = key.split('.').pop() ?? key;
    if (isContentKey(leaf) || isSecretKey(leaf)) continue;
    out[key] = typeof value === 'string' ? scrubSecretsInString(value).slice(0, 512) : value;
  }
  return out;
}

function recordFailure(span: Span, error: unknown): void {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? scrubSecretsInString(error.message) : 'non-error thrown';
  span.setAttribute('exception.type', name);
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

export interface WithSpanOptions {
  readonly kind?: SpanKind;
  readonly attributes?: SpanAttributeInput;
}

/**
 * Run `fn` inside an active span. The span carries the current `requestId`, ends when `fn`
 * settles, and records only the exception type and a scrubbed message on failure.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  options: WithSpanOptions = {},
): Promise<T> {
  const attributes = safeAttributes({
    ...options.attributes,
    'request.id': getRequestContext()?.requestId,
  });
  const spanOptions =
    options.kind === undefined ? { attributes } : { attributes, kind: options.kind };
  return tracer().startActiveSpan(name, spanOptions, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      recordFailure(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Standard metric names (spike §1). Durations are in milliseconds. */
export const METRICS = {
  httpServerDuration: 'http.server.duration',
  jobDuration: 'job.duration',
  dbQueryDuration: 'db.query.duration',
} as const;

function histogram(name: string, description: string): Histogram {
  return meter().createHistogram(name, { description, unit: 'ms' });
}

export function recordHttpServerDuration(ms: number, attributes: SpanAttributeInput): void {
  histogram(METRICS.httpServerDuration, 'Inbound HTTP request duration').record(
    ms,
    safeAttributes(attributes),
  );
}

export function recordJobDuration(ms: number, attributes: SpanAttributeInput): void {
  histogram(METRICS.jobDuration, 'Background job duration').record(ms, safeAttributes(attributes));
}

export function recordDbQueryDuration(ms: number, attributes: SpanAttributeInput): void {
  histogram(METRICS.dbQueryDuration, 'Database query duration').record(
    ms,
    safeAttributes(attributes),
  );
}
