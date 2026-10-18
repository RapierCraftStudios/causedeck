// Applies `migrations/` as the owner role (spike §4.3). A session-level advisory lock serialises
// concurrent runs (two deploys, or several replicas starting at once), so each migration is applied
// exactly once; a run that waited behind another finds nothing left to apply.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createOwnerDb } from './owner.ts';
import { redactError } from './redact.ts';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Arbitrary, fixed key for `pg_advisory_lock`: every CauseDeck migrator contends for it. */
export const MIGRATION_LOCK_KEY = 7_326_621_001n;

export interface MigrationLogger {
  info: (message: string) => void;
}

export interface RunMigrationsOptions {
  /** Owner-role URL (`DATABASE_URL_OWNER`). */
  url: Secret;
  migrationsFolder?: string;
  logger?: MigrationLogger;
}

export interface MigrationResult {
  /** Tags applied by this run, oldest first. Empty when the database was already up to date. */
  applied: string[];
  /** Latest tag recorded in the database after the run, if any. */
  latest: string | undefined;
}

interface JournalEntry {
  tag: string;
  when: number;
}

function readJournal(folder: string): JournalEntry[] {
  const file = path.join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(file, 'utf8')) as { entries: JournalEntry[] };
  return journal.entries;
}

const silent: MigrationLogger = { info: () => undefined };

export async function runMigrations({
  url,
  migrationsFolder = MIGRATIONS_FOLDER,
  logger = silent,
}: RunMigrationsOptions): Promise<MigrationResult> {
  const raw = url.reveal();
  const tags = new Map(readJournal(migrationsFolder).map((e) => [String(e.when), e.tag]));
  // One connection: the lock, the migrator and the unlock all run on the same session.
  const owner = createOwnerDb(url);
  try {
    await owner.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
    try {
      const before = await appliedMillis(owner);
      await migrate(owner, { migrationsFolder });
      const after = await appliedMillis(owner);
      const applied = after
        .filter((when) => !before.includes(when))
        .map((when) => tagOf(tags, when));
      const latestMillis = after.at(-1);
      const latest = latestMillis === undefined ? undefined : tagOf(tags, latestMillis);
      logger.info(
        applied.length > 0
          ? `Applied ${String(applied.length)} migration(s): ${applied.join(', ')}. Latest: ${latest ?? 'none'}.`
          : `No pending migrations. Latest: ${latest ?? 'none'}.`,
      );
      return { applied, latest };
    } finally {
      await owner.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
    }
  } catch (error) {
    throw redactError(error, [raw]);
  } finally {
    await owner.$client.end();
  }
}

function tagOf(tags: Map<string, string>, when: string): string {
  return tags.get(when) ?? `unknown(${when})`;
}

async function appliedMillis(owner: ReturnType<typeof createOwnerDb>): Promise<string[]> {
  const exists = await owner.execute<{ present: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
  );
  if (exists[0]?.present !== true) return [];
  const rows = await owner.execute<{ created_at: string }>(
    sql`select created_at::text from drizzle.__drizzle_migrations order by created_at`,
  );
  return rows.map((row) => row.created_at);
}
