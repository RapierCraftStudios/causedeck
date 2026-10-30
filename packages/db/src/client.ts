// Connection layer (spike §4.1). The apps connect as the non-owner app role (`DATABASE_URL`), so
// they cannot change the schema and cannot bypass RLS. Only migrations use the owner role.
import { serverEnv, type Secret } from '@causedeck/config/env';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import {
  authPoolEnabled,
  resolvePool,
  type PoolEnv,
  type PoolProbe,
  type PoolPurpose,
} from './pool.ts';
import { redactError } from './redact.ts';
import * as schema from './schema/index.ts';

export type DbRole = 'app' | 'owner';
export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema> & { $client: Sql };
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface CreateDbOptions {
  url: Secret;
  role: DbRole;
  /**
   * Pool size. Defaults: `DB_POOL_MAX` (10) for the app role, 1 for the owner role, and
   * `DB_AUTH_POOL_MAX` (3) for the `auth` purpose.
   */
  max?: number;
  /** Seconds before an idle connection closes. Default 20; 0 keeps connections open. */
  idleTimeout?: number;
  /** Seconds to wait for a connection. Default `DB_CONNECT_TIMEOUT_SECONDS` (5). */
  connectTimeout?: number;
  /** `auth` marks the small pool for Better Auth session lookups. Default `runtime`. */
  purpose?: PoolPurpose;
  /** The pool env; callers that have none (scripts, tests) get the defaults. */
  env?: PoolEnv;
}

/**
 * Build a Drizzle client over postgres-js. `prepare: false` keeps it compatible with transaction
 * pooling (PgBouncer, Supavisor). Errors raised while parsing the URL never include it.
 */
export function createDb({
  url,
  role,
  max,
  idleTimeout,
  connectTimeout,
  purpose,
  env,
}: CreateDbOptions): Database {
  const pool = resolvePool({ role, purpose, env, max, connectTimeout });
  const raw = url.reveal();
  let client: Sql;
  try {
    client = postgres(raw, {
      max: pool.max,
      prepare: false,
      idle_timeout: idleTimeout ?? 20,
      connect_timeout: pool.connectTimeout,
      connection: { application_name: pool.applicationName },
      onnotice: () => undefined,
    });
  } catch (error) {
    throw redactError(error, [raw]);
  }
  return drizzle({ client, schema, casing: 'snake_case' });
}

let appDb: Database | undefined;
let authDbInstance: Database | undefined;

function appDatabase(): Database {
  if (appDb === undefined) {
    const env = serverEnv();
    appDb = createDb({ url: env.DATABASE_URL, role: 'app', env });
  }
  return appDb;
}

function authDatabase(): Database {
  const env = serverEnv();
  if (!authPoolEnabled(env)) return appDatabase();
  if (authDbInstance === undefined) {
    authDbInstance = createDb({ url: env.DATABASE_URL, role: 'app', purpose: 'auth', env });
  }
  return authDbInstance;
}

/** The runtime client (app role, `DATABASE_URL`). Connects on first use. */
export const db: Database = new Proxy({} as Database, {
  get: (_target, prop) => Reflect.get(appDatabase(), prop) as unknown,
});

/**
 * The small pool for Better Auth session lookups (#805), separate from `db` so a page-load burst of
 * queries cannot starve `getSession`. It is `db` itself when `DB_AUTH_POOL_MAX=0`. Connects on first use.
 */
export const authDb: Database = new Proxy({} as Database, {
  get: (_target, prop) => Reflect.get(authDatabase(), prop) as unknown,
});

/** Whether `authDb` is its own pool (false: it is `db`). Reads the env, so call it at runtime only. */
export function hasDedicatedAuthPool(): boolean {
  return authPoolEnabled(serverEnv());
}

/**
 * Sample a pool: time a probe query (it queues behind busy connections, so the time is the pool wait
 * plus one round trip) and read the app-role connections' states from pg_stat_activity. An error is
 * thrown to the caller: a connect timeout is the signal alerts count.
 */
export async function probeDbPool(database: Database): Promise<PoolProbe> {
  const started = performance.now();
  const rows = await database.$client<
    {
      connections: number;
      active: number;
      idle_in_transaction: number;
      idle_in_transaction_max_seconds: number;
    }[]
  >`select count(*)::int as connections,
           count(*) filter (where state = 'active')::int as active,
           count(*) filter (where state like 'idle in transaction%')::int as idle_in_transaction,
           coalesce(max(extract(epoch from now() - state_change))
             filter (where state like 'idle in transaction%'), 0)::float8 as idle_in_transaction_max_seconds
    from pg_stat_activity
    where datname = current_database() and application_name like 'causedeck-app%'`;
  const waitSeconds = (performance.now() - started) / 1000;
  const row = rows[0];
  return {
    waitSeconds,
    connections: row?.connections ?? 0,
    active: row?.active ?? 0,
    idleInTransaction: row?.idle_in_transaction ?? 0,
    idleInTransactionMaxSeconds: row?.idle_in_transaction_max_seconds ?? 0,
  };
}

/**
 * Close the runtime pools (graceful shutdown and tests). `timeout` (seconds) bounds the wait for
 * open queries before connections are closed; without it, `end()` waits for them.
 */
export async function closeDb(options?: { timeout?: number }): Promise<void> {
  const current = appDb;
  const auth = authDbInstance;
  appDb = undefined;
  authDbInstance = undefined;
  await Promise.all([current?.$client.end(options), auth?.$client.end(options)]);
}
