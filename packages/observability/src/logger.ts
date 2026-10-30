// Structured JSON logger (spike §1, §6): one JSON object per line on stdout, UTC ISO-8601 time,
// base service fields, request correlation from AsyncLocalStorage and redaction by default.
import { isSpanContextValid, trace } from '@opentelemetry/api';

import { serverEnv } from '@causedeck/config/env';
import { pino, stdTimeFunctions, type DestinationStream, type Level, type Logger } from 'pino';

import { getRequestContext } from './context.ts';
import { redactDeep, redactPaths, REDACTED, scrubSecretsInString } from './redact.ts';

export type { Logger } from 'pino';

export type LogLevel = Level | 'silent';

export interface RuntimeInfo {
  readonly env: 'development' | 'test' | 'production';
  readonly version: string;
  readonly region: string;
  readonly level: LogLevel;
}

/**
 * Service metadata from the validated env. Falls back to production-safe values when the env is
 * invalid so the logger can still report the validation error.
 */
export function runtimeInfo(): RuntimeInfo {
  try {
    const env = serverEnv();
    return {
      env: env.NODE_ENV,
      version: env.GIT_SHA ?? 'dev',
      region: env.AWS_REGION,
      level: env.LOG_LEVEL,
    };
  } catch {
    return { env: 'production', version: 'unknown', region: 'unknown', level: 'info' };
  }
}

export interface CreateLoggerOptions {
  /** Service name, e.g. `web`, `api`, `worker`, `admin`. */
  readonly service: string;
  /** Defaults to `LOG_LEVEL`. */
  readonly level?: LogLevel;
  /** Defaults to stdout. Tests pass an in-memory stream. */
  readonly destination?: DestinationStream;
  /** Overrides for the env-derived base fields. */
  readonly runtime?: Partial<RuntimeInfo>;
}

export interface SerializedError {
  type: string;
  name: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: SerializedError | string;
}

const MAX_CAUSE_DEPTH = 5;

/**
 * Serialize an error for logs: name and scrubbed message always, stack only outside production,
 * and the `cause` chain preserved (depth-limited).
 */
export function serializeError(
  err: unknown,
  options: { includeStack: boolean },
  depth = 0,
): SerializedError | string {
  if (!(err instanceof Error)) {
    return typeof err === 'string' ? scrubSecretsInString(err) : REDACTED;
  }
  const out: SerializedError = {
    type: err.constructor.name,
    name: err.name,
    message: scrubSecretsInString(err.message),
  };
  if (options.includeStack && err.stack !== undefined) {
    out.stack = scrubSecretsInString(err.stack);
  }
  const code: unknown = (err as { code?: unknown }).code;
  if (typeof code === 'string') out.code = code;
  if (err.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    out.cause = serializeError(err.cause, options, depth + 1);
  }
  return out;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const runtime = { ...runtimeInfo(), ...options.runtime };
  const includeStack = runtime.env !== 'production';
  const errSerializer = (err: unknown) => serializeError(err, { includeStack });

  return pino(
    {
      level: options.level ?? runtime.level,
      base: {
        service: options.service,
        env: runtime.env,
        version: runtime.version,
        region: runtime.region,
      },
      timestamp: stdTimeFunctions.isoTime,
      messageKey: 'msg',
      errorKey: 'err',
      serializers: {
        err: errSerializer,
        error: errSerializer,
        msg: (msg: unknown) => (typeof msg === 'string' ? scrubSecretsInString(msg) : msg),
      },
      redact: { paths: redactPaths, censor: REDACTED },
      formatters: {
        level: (label) => ({ level: label }),
        bindings: (bindings) => redactDeep(bindings) as Record<string, unknown>,
        log: (object) => redactDeep(object) as Record<string, unknown>,
      },
      mixin: () => {
        const fields: Record<string, string> = {};
        const span = trace.getActiveSpan()?.spanContext();
        if (span !== undefined && isSpanContextValid(span)) {
          fields.trace_id = span.traceId;
          fields.span_id = span.spanId;
        }
        const ctx = getRequestContext();
        if (ctx === undefined) return fields;
        // snake_case is the log-pipeline schema (Loki labels, spike §1); camelCase stays for existing readers.
        fields.requestId = ctx.requestId;
        fields.request_id = ctx.requestId;
        if (ctx.workspaceId !== undefined) {
          fields.workspaceId = ctx.workspaceId;
          fields.workspace_id = ctx.workspaceId;
        }
        if (ctx.userId !== undefined) fields.userId = ctx.userId;
        if (ctx.jobId !== undefined) fields.jobId = ctx.jobId;
        return fields;
      },
    },
    options.destination ?? pino.destination({ dest: 1, sync: false }),
  );
}
