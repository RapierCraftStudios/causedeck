// Pool sizing for the postgres-js clients (#805). Pure: `client.ts` feeds it the parsed env, tests
// feed it literals. Precedence is explicit option, then env, then the default below.
import type { DbRole } from './client.ts';

export const DEFAULT_POOL_MAX: Record<DbRole, number> = { app: 10, owner: 1 };
/** The dedicated pool for Better Auth session lookups. */
export const DEFAULT_AUTH_POOL_MAX = 3;
/** Fail fast: a saturated database should error in seconds, not hang a page for postgres-js's 30. */
export const DEFAULT_CONNECT_TIMEOUT_SECONDS = 5;

/** What a pool serves: page-load queries (`runtime`) or Better Auth's session lookups (`auth`). */
export type PoolPurpose = 'runtime' | 'auth';

/** The slice of `serverEnv()` the pools read. */
export interface PoolEnv {
  DB_POOL_MAX?: number | undefined;
  DB_AUTH_POOL_MAX?: number | undefined;
  DB_CONNECT_TIMEOUT_SECONDS?: number | undefined;
}

export interface PoolRequest {
  role: DbRole;
  purpose?: PoolPurpose | undefined;
  env?: PoolEnv | undefined;
  max?: number | undefined;
  connectTimeout?: number | undefined;
}

export interface PoolSettings {
  max: number;
  /** Seconds, postgres-js `connect_timeout`. */
  connectTimeout: number;
  /** Shown in pg_stat_activity: the pools are told apart by it. */
  applicationName: string;
}

function positiveInt(value: number | undefined, name: string, min: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(
      `${name} must be an integer of at least ${String(min)}, got ${String(value)}`,
    );
  }
  return value;
}

export function resolvePool({
  role,
  purpose = 'runtime',
  env = {},
  max,
  connectTimeout,
}: PoolRequest): PoolSettings {
  const fromEnv =
    purpose === 'auth' ? env.DB_AUTH_POOL_MAX : role === 'app' ? env.DB_POOL_MAX : undefined;
  const fallback = purpose === 'auth' ? DEFAULT_AUTH_POOL_MAX : DEFAULT_POOL_MAX[role];
  return {
    max: positiveInt(max, 'max', 1) ?? positiveInt(fromEnv, 'pool size', 1) ?? fallback,
    connectTimeout:
      positiveInt(connectTimeout, 'connectTimeout', 1) ??
      positiveInt(env.DB_CONNECT_TIMEOUT_SECONDS, 'DB_CONNECT_TIMEOUT_SECONDS', 1) ??
      DEFAULT_CONNECT_TIMEOUT_SECONDS,
    applicationName: purpose === 'auth' ? `causedeck-${role}-auth` : `causedeck-${role}`,
  };
}

/** Whether the dedicated auth pool is on: `DB_AUTH_POOL_MAX=0` shares the runtime pool. */
export function authPoolEnabled(env: PoolEnv): boolean {
  return (env.DB_AUTH_POOL_MAX ?? DEFAULT_AUTH_POOL_MAX) > 0;
}

/** One sample of a pool's health, taken with a probe query (see `probeDbPool`). */
export interface PoolProbe {
  /** Seconds from asking for a connection to the answer: queueing for a free one plus the query. */
  waitSeconds: number;
  /** Connections of this application name by state, from pg_stat_activity. */
  connections: number;
  active: number;
  idleInTransaction: number;
  /** Age in seconds of the longest idle-in-transaction connection, 0 when there is none. */
  idleInTransactionMaxSeconds: number;
}
