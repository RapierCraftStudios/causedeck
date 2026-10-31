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

/** Readiness fails when the local clock differs from the reference by more than this. */
export const MAX_CLOCK_DRIFT_MS = 1000;

export interface ClockDriftOptions {
  /** Reference time in epoch ms from an NTP-synced source. */
  readonly reference: () => Promise<number>;
  readonly now?: () => number;
  readonly maxDriftMs?: number;
}

/**
 * Fails readiness when the clock drifts more than `maxDriftMs` (default 1 s) from the reference.
 * `reference` may be truncated to whole seconds (HTTP `Date`), so up to 1 s of that is not drift.
 */
export function createClockDriftCheck(options: ClockDriftOptions): HealthCheck {
  const now = options.now ?? Date.now;
  const max = options.maxDriftMs ?? MAX_CLOCK_DRIFT_MS;
  return async () => {
    const reference = await options.reference();
    const delta = now() - reference;
    const drift = delta >= 0 ? Math.max(0, delta - 1000) : -delta;
    if (drift > max) throw new Error(`clock drift ${String(drift)} ms exceeds ${String(max)} ms`);
  };
}

/** Reference time from the `Date` header of a HEAD request to `url`. */
export function httpDateReference(
  url: string,
  fetchFn: typeof fetch = fetch,
): () => Promise<number> {
  return async () => {
    const response = await fetchFn(url, { method: 'HEAD', signal: AbortSignal.timeout(1500) });
    const parsed = Date.parse(response.headers.get('date') ?? '');
    if (Number.isNaN(parsed)) throw new Error('reference has no Date header');
    return parsed;
  };
}

/**
 * The clock check for `CLOCK_DRIFT_REFERENCE_URL`, or `undefined` when it is unset (dev, tests).
 * Production sets it so a host with a broken NTP leaves the load balancer rotation.
 */
export function clockDriftCheckFromEnv(
  // eslint-disable-next-line no-process-env -- optional host-level probe, not validated app config.
  env: Record<string, string | undefined> = process.env,
): HealthCheck | undefined {
  const url = env.CLOCK_DRIFT_REFERENCE_URL;
  if (url === undefined || url === '') return undefined;
  return createClockDriftCheck({ reference: httpDateReference(url) });
}
