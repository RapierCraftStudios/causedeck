// Test harness entry point (`@causedeck/db/testing`). Point a package's Vitest `globalSetup` at
// `@causedeck/db/testing/global-setup` (see packages/db/vitest.global-setup.ts); tests then call
// `withTestDb()`.
import { Secret } from '@causedeck/config/env';
import { sql, TransactionRollbackError } from 'drizzle-orm';
import { inject } from 'vitest';

import { createDb, type Database, type Transaction } from '../client.ts';
import { createOwnerDb } from '../owner.ts';
import { withWorkspace } from '../rls.ts';
import type { TestDatabaseUrls } from './container.ts';
// Brings in the `ProvidedContext` augmentation for `inject()`.
import type {} from './global-setup.ts';

export {
  createScratchDatabase,
  POSTGRES_IMAGE,
  ROLES,
  startTestDatabase,
  type StartedTestDatabase,
  type TestDatabaseUrls,
} from './container.ts';

/** Connection URLs of the shared test database (from `globalSetup`). */
export function testDatabaseUrls(): TestDatabaseUrls {
  return inject('causedeckDbUrls');
}

let appDb: Database | undefined;

/** The app-role client for the shared test database, one pool per test worker. */
export function testAppDb(): Database {
  return (appDb ??= createDb({ url: new Secret(testDatabaseUrls().app), role: 'app', max: 4 }));
}

/**
 * Run `fn` inside a transaction on the app role and always roll it back, so tests (and test files
 * running in parallel workers) never see each other's writes. Expected statement failures must use
 * a nested `tx.transaction()` (a savepoint) so the outer transaction stays usable.
 */
export async function withTestDb<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  let result: { value: T } | undefined;
  try {
    await testAppDb().transaction(async (tx) => {
      result = { value: await fn(tx) };
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError) || result === undefined) throw error;
  }
  if (result === undefined) throw new Error('withTestDb: transaction ended without a result');
  return result.value;
}

/**
 * Fixtures under FORCE row-level security (#19): run `fn` on a savepoint of the test transaction
 * scoped to `workspaceId` (and `userId`), so tenant rows can be inserted and read. The outer
 * transaction's scope is restored afterwards. Owner sessions do not help here: FORCE RLS binds the
 * owner too, and it has no BYPASSRLS.
 */
export function inWorkspace<T>(
  tx: Transaction,
  workspaceId: string,
  fn: (scoped: Transaction) => Promise<T>,
  userId?: string,
): Promise<T> {
  return withWorkspace(tx, userId === undefined ? { workspaceId } : { workspaceId, userId }, fn);
}

/**
 * Empty every table in `public` except `schema_info` (as the owner; the app role has no TRUNCATE). For suites that must
 * commit, such as tests of code that opens its own transactions. Not safe alongside parallel files
 * that commit to the same tables.
 */
export async function truncateAll(): Promise<void> {
  const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
  try {
    const rows = await owner.execute<{ name: string }>(
      sql`select quote_ident(tablename) as name from pg_tables where schemaname = 'public' and tablename <> 'schema_info'`,
    );
    if (rows.length > 0) {
      // The append-only audit tables (#226) reject TRUNCATE outside the retention path.
      await owner.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.audit_retention', 'on', true)`);
        await tx.execute(
          sql.raw(`truncate table ${rows.map((r) => r.name).join(', ')} restart identity cascade`),
        );
      });
    }
  } finally {
    await owner.$client.end();
  }
}

/** Close the worker's app-role pool. */
export async function closeTestDb(): Promise<void> {
  const current = appDb;
  appDb = undefined;
  await current?.$client.end();
}
