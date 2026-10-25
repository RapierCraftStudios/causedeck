// Testcontainers Postgres for integration tests: the same pgvector image as the #5 dev stack, the
// same init SQL (extensions, owner and app roles, read from infra/docker/postgres/init so the two
// cannot drift) and the committed migrations applied as the owner role.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Secret } from '@causedeck/config/env';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';

import { runMigrations } from '../migrate.ts';

/** Keep in step with infra/docker/compose.dev.yml. */
export const POSTGRES_IMAGE = 'pgvector/pgvector:0.8.7-pg17';

export const INIT_SQL_DIR = fileURLToPath(
  new URL('../../../../infra/docker/postgres/init', import.meta.url),
);

/** Role names and dev passwords from infra/docker/postgres/init/02-roles.sql. */
export const ROLES = {
  owner: { user: 'causedeck_owner', password: 'causedeck_owner' },
  app: { user: 'causedeck_app', password: 'causedeck_app' },
} as const;

/** The no-login role clerk members run as inside `withWorkspace({ dbRole: 'clerk' })` (#233). */
export const CLERK_ROLE = 'causedeck_clerk';

export const DATABASE_NAME = 'causedeck';
/** Copy of `causedeck` taken after the init SQL and before migrations: the scratch-DB template. */
export const PRISTINE_TEMPLATE = 'causedeck_pristine';

export interface TestDatabaseUrls {
  /** Bootstrap superuser: only for creating scratch databases in tests. */
  superuser: string;
  owner: string;
  app: string;
}

export interface StartedTestDatabase {
  urls: TestDatabaseUrls;
  stop: () => Promise<void>;
}

function roleUrl(container: StartedPostgreSqlContainer, role: keyof typeof ROLES, db: string) {
  const { user, password } = ROLES[role];
  return `postgres://${user}:${password}@${container.getHost()}:${String(container.getPort())}/${db}`;
}

/** Run the #5 init scripts, in order, against `superuserUrl`. */
export async function applyInitSql(superuserUrl: string): Promise<void> {
  const sql = postgres(superuserUrl, { max: 1, onnotice: () => undefined });
  try {
    const files = readdirSync(INIT_SQL_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) await sql.unsafe(readFileSync(path.join(INIT_SQL_DIR, file), 'utf8'));
  } finally {
    await sql.end();
  }
}

/**
 * In a throwaway lane sandbox (computeshare sets IS_SANDBOX=1) Testcontainers' Ryuk reaper never
 * reports "Started" on the sandbox's private dockerd, which fails every DB test setup. The sandbox and
 * its dockerd are discarded after the lane, so the reaper has nothing to clean up. CI and dev keep Ryuk.
 */
function disableRyukInSandbox(): void {
  // eslint-disable-next-line no-process-env -- a test-runner switch for Testcontainers, not app configuration.
  const env = process.env;
  if (env.IS_SANDBOX === '1') env.TESTCONTAINERS_RYUK_DISABLED ??= 'true';
}

/** Start Postgres 17 + pgvector, create the roles and apply every migration as the owner. */
export async function startTestDatabase(): Promise<StartedTestDatabase> {
  disableRyukInSandbox();
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(DATABASE_NAME)
    .withUsername('causedeck')
    .withPassword('causedeck')
    .start();
  const superuser = container.getConnectionUri();
  await applyInitSql(superuser);
  await adminQuery(superuser, `create database ${PRISTINE_TEMPLATE} template ${DATABASE_NAME}`);
  const urls = {
    superuser,
    owner: roleUrl(container, 'owner', DATABASE_NAME),
    app: roleUrl(container, 'app', DATABASE_NAME),
  };
  await runMigrations({ url: new Secret(urls.owner) });
  return {
    urls,
    stop: async () => {
      await container.stop();
    },
  };
}

/** Run one statement from the `postgres` maintenance database (CREATE/DROP DATABASE). */
async function adminQuery(superuserUrl: string, statement: string): Promise<void> {
  const url = new URL(superuserUrl);
  url.pathname = '/postgres';
  const sql = postgres(url.toString(), { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe(statement);
  } finally {
    await sql.end();
  }
}

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/**
 * A new database cloned from the pristine template: extensions, schema ownership and default
 * privileges exactly as the init SQL left them, but no migrations. For migration tests.
 */
export async function createScratchDatabase(
  urls: TestDatabaseUrls,
  name: string,
): Promise<{ owner: string; app: string; drop: () => Promise<void> }> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new TypeError(`invalid database name: ${name}`);
  await adminQuery(
    urls.superuser,
    `create database ${name} template ${PRISTINE_TEMPLATE} owner ${ROLES.owner.user}`,
  );
  return {
    owner: withDatabase(urls.owner, name),
    app: withDatabase(urls.app, name),
    drop: () => adminQuery(urls.superuser, `drop database if exists ${name} with (force)`),
  };
}
