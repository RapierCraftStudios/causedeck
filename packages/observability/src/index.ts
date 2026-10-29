/** Logger, OpenTelemetry, Sentry wiring and health endpoints (spike §1, §3.2, §6). */
export const packageName: string = '@causedeck/observability';

export { ADAPTER_METRICS, recordAdapterRun, resetAdapterMetrics } from './adapter-metrics.ts';
export {
  DB_POOL_METRICS,
  registerDbPoolMetrics,
  resetDbPoolMetrics,
  type DbPoolProbes,
  type DbPoolSample,
} from './db-pool-metrics.ts';
export {
  getRequestContext,
  REQUEST_ID_HEADER,
  requestIdFrom,
  withRequestContext,
  type RequestContext,
} from './context.ts';
export {
  createHealthHandlers,
  DEFAULT_CHECK_TIMEOUT_MS,
  HEALTH_PATHS,
  isHealthPath,
  type CheckResult,
  type CreateHealthHandlersOptions,
  type Handler,
  type HealthCheck,
  type HealthHandlers,
  type ReadyBody,
} from './health.ts';
export {
  honoRequestLogger,
  withRequestLogging,
  type HonoLikeContext,
  type HonoLikeMiddleware,
  type RequestLogLine,
  type RequestLogOptions,
} from './http.ts';
export {
  createLogger,
  runtimeInfo,
  serializeError,
  type CreateLoggerOptions,
  type Logger,
  type LogLevel,
  type RuntimeInfo,
  type SerializedError,
} from './logger.ts';
export {
  initTelemetry,
  meter,
  METRICS,
  PROD_SAMPLE_RATIO,
  recordDbQueryDuration,
  recordHttpServerDuration,
  recordJobDuration,
  safeAttributes,
  samplerFor,
  tracer,
  withSpan,
  type InitTelemetryOptions,
  type SpanAttributeInput,
  type Telemetry,
  type WithSpanOptions,
} from './otel.ts';
export {
  CONTENT_KEYS,
  contentPlaceholder,
  isContentKey,
  isSecretKey,
  REDACTED,
  redactDeep,
  redactPaths,
  scrubSecretsInString,
  SECRET_KEY_PATTERN,
} from './redact.ts';
export { beforeSend, initSentry, type InitSentryOptions } from './sentry.ts';
