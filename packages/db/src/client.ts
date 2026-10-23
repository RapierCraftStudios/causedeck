// Connection layer (spike §4.1). The apps connect as the non-owner app role (`DATABASE_URL`), so
// they cannot change the schema and cannot bypass RLS. Only migrations use the owner role.
import { serverEnv, type Secret } from '@causedeck/config/env';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { redactError } from './redact.ts';
import * as schema from './schema/index.ts';

export type DbRole = 'app' | 'owner';
export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema> & { $client: Sql };
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface CreateDbOptions {
  url: Secret;
  role: DbRole;
  /** Pool size. Defaults: 10 for the app role, 1 for the owner role. */
  max?: number;
  /** Seconds before an idle connection closes. Default 20; 0 keeps connections open. */
  idleTimeout?: number;
}

const DEFAULT_MAX: Record<DbRole, number> = { app: 10, owner: 1 };

/**
 * Build a Drizzle client over postgres-js. `prepare: false` keeps it compatible with transaction
 * pooling (PgBouncer, Supavisor). Errors raised while parsing the URL never include it.
 */
export function createDb({ url, role, max, idleTimeout }: CreateDbOptions): Database {
  const raw = url.reveal();
  let client: Sql;
  try {
    client = postgres(raw, {
      max: max ?? DEFAULT_MAX[role],
      prepare: false,
      idle_timeout: idleTimeout ?? 20,
      connection: { application_name: `causedeck-${role}` },
      onnotice: () => undefined,
    });
  } catch (error) {
    throw redactError(error, [raw]);
  }
  return drizzle({ client, schema, casing: 'snake_case' });
}

let appDb: Database | undefined;

function appDatabase(): Database {
  return (appDb ??= createDb({ url: serverEnv().DATABASE_URL, role: 'app' }));
}

/** The runtime client (app role, `DATABASE_URL`). Connects on first use. */
export const db: Database = new Proxy({} as Database, {
  get: (_target, prop) => Reflect.get(appDatabase(), prop) as unknown,
});

/**
 * Close the runtime pool (graceful shutdown and tests). `timeout` (seconds) bounds the wait for
 * open queries before connections are closed; without it, `end()` waits for them.
 */
export async function closeDb(options?: { timeout?: number }): Promise<void> {
  const current = appDb;
  appDb = undefined;
  await current?.$client.end(options);
}
