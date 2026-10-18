// Health and readiness endpoints (spike §3.2): Web-standard `Request → Response` handlers that
// every service mounts. `healthz` never touches dependencies; `readyz` runs registered checks.
import { getRequestContext, REQUEST_ID_HEADER, requestIdFrom } from './context.ts';
import { runtimeInfo } from './logger.ts';

export type HealthCheck = () => Promise<void>;

export type Handler = (request: Request) => Promise<Response>;

export interface CheckResult {
  ok: boolean;
  ms: number;
}

export interface ReadyBody {
  status: 'ok' | 'error';
  checks: Record<string, CheckResult>;
  version: string;
}

export interface HealthHandlers {
  healthz: Handler;
  readyz: Handler;
  /** Add a readiness check, e.g. db `select 1`, storage head-bucket, migrations current. */
  registerCheck: (name: string, fn: HealthCheck) => void;
}

export interface CreateHealthHandlersOptions {
  readonly checks?: Record<string, HealthCheck>;
  /** Defaults to `GIT_SHA`. */
  readonly version?: string;
  /** Per-check timeout. */
  readonly timeoutMs?: number;
}

export const DEFAULT_CHECK_TIMEOUT_MS = 2000;

/** Paths that must bypass auth middleware and log at `debug`. */
export const HEALTH_PATHS: readonly string[] = ['/healthz', '/readyz'];

export function isHealthPath(pathname: string): boolean {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return HEALTH_PATHS.includes(trimmed);
}

class CheckTimeoutError extends Error {
  override name = 'CheckTimeoutError';
}

async function runCheck(fn: HealthCheck, timeoutMs: number): Promise<CheckResult> {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new CheckTimeoutError('check timed out'));
    }, timeoutMs);
  });
  try {
    await Promise.race([Promise.resolve().then(fn), timeout]);
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch {
    // Never leak error details from a readiness probe.
    return { ok: false, ms: Math.round(performance.now() - start) };
  } finally {
    clearTimeout(timer);
  }
}

function json(body: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      [REQUEST_ID_HEADER]: getRequestContext()?.requestId ?? requestIdFrom(request.headers),
    },
  });
}

export function createHealthHandlers(options: CreateHealthHandlersOptions = {}): HealthHandlers {
  const checks = new Map<string, HealthCheck>(Object.entries(options.checks ?? {}));
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const version = (): string => options.version ?? runtimeInfo().version;

  return {
    healthz: (request) => Promise.resolve(json({ status: 'ok', version: version() }, 200, request)),

    readyz: async (request) => {
      const entries = [...checks.entries()];
      const results = await Promise.all(entries.map(([, fn]) => runCheck(fn, timeoutMs)));
      const body: ReadyBody = { status: 'ok', checks: {}, version: version() };
      entries.forEach(([name], i) => {
        const result = results[i] ?? { ok: false, ms: 0 };
        body.checks[name] = result;
        if (!result.ok) body.status = 'error';
      });
      return json(body, body.status === 'ok' ? 200 : 503, request);
    },

    registerCheck: (name, fn) => {
      checks.set(name, fn);
    },
  };
}
