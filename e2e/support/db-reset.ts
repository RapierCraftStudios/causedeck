// Database lifecycle for the e2e harness (#16). One template database (`causedeck_e2e_template`) is
// built per run: migrated, seeded with the `e2e` profile and warmed with per-role sessions. Each
// Playwright worker then gets its own clone (`CREATE DATABASE … TEMPLATE …`), and `resetWorkerDb`
// drops and re-clones it before every test, so tests never see each other's writes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { symmetricEncrypt } from 'better-auth/crypto';
import postgres from 'postgres';

import { ADMIN_FIXTURES, ADMIN_TOTP_SECRET } from '../fixtures/admin-data.ts';
import {
  CATALOGUE_EXPECTATIONS,
  COURT_PARSE_RUNS,
  COURTS_ADAPTER_ID,
  COURTS_ADAPTER_VERSION,
  COURTS_WORKSPACE_ID,
} from '../fixtures/courts-data.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/* eslint-disable no-process-env -- the harness is configured by its own env vars, read here. */
/** Database name prefix; set `E2E_DB_PREFIX` when two harness runs share one Postgres. */
export const DB_PREFIX = process.env.E2E_DB_PREFIX ?? 'causedeck_e2e';
/** Compose dev stack superuser (infra/docker/compose.dev.yml); only for CREATE/DROP DATABASE. */
const SUPERUSER_URL =
  process.env.E2E_DB_SUPERUSER_URL ?? 'postgres://causedeck:causedeck@127.0.0.1:5432/postgres';
/** Fail a reset slower than this when `E2E_ASSERT_RESET_MS` is set (CI). */
const RESET_BUDGET_MS = Number(process.env.E2E_ASSERT_RESET_MS ?? 0);
/* eslint-enable no-process-env */

/** Role names and dev passwords from infra/docker/postgres/init/02-roles.sql. */
const ROLES = {
  owner: { user: 'causedeck_owner', password: 'causedeck_owner' },
  app: { user: 'causedeck_app', password: 'causedeck_app' },
} as const;

export const TEMPLATE_DB = `${DB_PREFIX}_template`;

/** Fixed dev secret: sessions minted in global setup must verify on every worker server. */
export const E2E_AUTH_SECRET = 'e2e-only-better-auth-secret-0123456789abcdef';

export function workerDbName(workerIndex: number): string {
  return `${DB_PREFIX}_w${String(workerIndex)}`;
}

/** URL of `database` for `role` (`superuser`, `owner` or `app`). */
export function databaseUrl(database: string, role: 'superuser' | keyof typeof ROLES): string {
  const url = new URL(SUPERUSER_URL);
  url.pathname = `/${database}`;
  if (role !== 'superuser') {
    url.username = ROLES[role].user;
    url.password = ROLES[role].password;
  }
  return url.toString();
}

function assertName(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new TypeError(`invalid database name: ${name}`);
  return name;
}

/** Run statements on the `postgres` maintenance database as the superuser. */
async function admin(statements: string[], database = 'postgres'): Promise<void> {
  const sql = postgres(databaseUrl(database, 'superuser'), {
    max: 1,
    onnotice: () => undefined,
    connect_timeout: 5,
  });
  try {
    for (const statement of statements) await sql.unsafe(statement);
  } finally {
    await sql.end();
  }
}

/** Throws a readable error when the compose Postgres or Mailpit is not reachable. */
export async function assertStackUp(mailpitUrl: string): Promise<void> {
  const hint = 'Start the dev stack first: pnpm stack:up';
  try {
    await admin(['select 1']);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`e2e: cannot reach Postgres (${reason}). ${hint}`);
  }
  const mailpit = await fetch(`${mailpitUrl}/readyz`).catch(() => undefined);
  if (!mailpit?.ok) throw new Error(`e2e: cannot reach Mailpit at ${mailpitUrl}. ${hint}`);
}

/**
 * The init SQL of the compose stack, applied to a fresh database: extensions, plus the schema
 * ownership and default privileges from 02-roles.sql (the roles themselves already exist).
 */
function initStatements(database: string): string[] {
  const dir = path.join(repoRoot, 'infra/docker/postgres/init');
  const extensions = readFileSync(path.join(dir, '01-extensions.sql'), 'utf8');
  const roles = readFileSync(path.join(dir, '02-roles.sql'), 'utf8');
  return [extensions, roles]
    .flatMap((file) => file.replace(/--.*$/gm, '').split(';'))
    .map((s) => s.trim())
    .filter((s) => s !== '' && !/^create role/i.test(s))
    .map((s) => s.replace(/^alter database \w+/i, `ALTER DATABASE ${database}`));
}

async function dropDatabase(name: string): Promise<void> {
  const db = assertName(name);
  const exists = postgres(databaseUrl('postgres', 'superuser'), {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const rows = await exists`select 1 from pg_database where datname = ${db}`;
    if (rows.length === 0) return;
    await exists.unsafe(`alter database ${db} is_template false allow_connections true`);
    await exists.unsafe(`drop database ${db} with (force)`);
  } finally {
    await exists.end();
  }
}

/** Run a packages/db script (`migrate.ts`, `seed.ts`) with tsx; no pnpm needed (CI container). */
function runDbScript(
  script: 'migrate.ts' | 'seed.ts',
  env: Record<string, string>,
  args: string[],
) {
  const dbDir = path.join(repoRoot, 'packages/db');
  execFileSync(path.join(dbDir, 'node_modules/.bin/tsx'), [`scripts/${script}`, ...args], {
    cwd: dbDir,
    stdio: ['ignore', 'pipe', 'inherit'],
    // eslint-disable-next-line no-process-env -- the child inherits PATH and the CI flags.
    env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'warn', ...env },
  });
}

/**
 * The e2e stack runs no worker, which normally installs the `pgboss` schema and the queues.
 * Producers (the web and admin servers) refuse to start without them, so install them once here,
 * with the worker's own code (apps/worker/scripts/e2e-install-pgboss.ts), as the owner role.
 */
function installPgBoss(): void {
  const workerDir = path.join(repoRoot, 'apps/worker');
  execFileSync(path.join(workerDir, 'node_modules/.bin/tsx'), ['scripts/e2e-install-pgboss.ts'], {
    cwd: workerDir,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: {
      // eslint-disable-next-line no-process-env -- the child inherits PATH and the CI flags.
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      DATABASE_URL_OWNER: databaseUrl(TEMPLATE_DB, 'owner'),
    },
  });
}

/**
 * Build the template: fresh database, init SQL, migrations (owner, with the forum catalogue), the
 * `e2e` seed (app), then the admin console and courts fixtures (owner).
 */
export async function createTemplateDb(): Promise<void> {
  await dropDatabase(TEMPLATE_DB);
  await admin([`create database ${TEMPLATE_DB} template template0 owner ${ROLES.owner.user}`]);
  await admin(initStatements(TEMPLATE_DB), TEMPLATE_DB);
  runDbScript('migrate.ts', { DATABASE_URL_OWNER: databaseUrl(TEMPLATE_DB, 'owner') }, []);
  installPgBoss();
  runDbScript('seed.ts', { DATABASE_URL: databaseUrl(TEMPLATE_DB, 'app') }, ['--profile', 'e2e']);
  await seedAdminFixtures();
  await seedCourtFixtures();
}

/**
 * Admin console fixtures (#309): staff accounts with and without TOTP, a disabled one, and a
 * non-staff user with TOTP. `staff_user` is write-revoked for the app role, so this runs as the
 * owner (the e2e seed runs as the app role). TOTP secrets are encrypted with the e2e auth secret,
 * exactly as Better Auth's twoFactor plugin stores them.
 */
async function seedAdminFixtures(): Promise<void> {
  const sql = postgres(databaseUrl(TEMPLATE_DB, 'owner'), { max: 1, onnotice: () => undefined });
  try {
    const secret = await symmetricEncrypt({ key: E2E_AUTH_SECRET, data: ADMIN_TOTP_SECRET });
    const backupCodes = await symmetricEncrypt({ key: E2E_AUTH_SECRET, data: '[]' });
    for (const fixture of Object.values(ADMIN_FIXTURES)) {
      const [row] = await sql<{ id: string }[]>`
        insert into "user" (name, email, email_verified, two_factor_enabled)
        values (${fixture.email.split('@')[0] ?? 'staff'}, ${fixture.email}, true, ${fixture.twoFactor})
        returning id`;
      if (!row) throw new Error(`e2e: admin fixture ${fixture.email} not created`);
      if (fixture.twoFactor) {
        await sql`
          insert into two_factor (secret, backup_codes, user_id, verified)
          values (${secret}, ${backupCodes}, ${row.id}, true)`;
      }
      if (fixture.role !== null) {
        const disabled = fixture.email.startsWith('staff-disabled@');
        await sql`
          insert into staff_user (user_id, role, disabled_at)
          values (${row.id}, ${fixture.role}, case when ${disabled} then now() else null end)`;
      }
    }
  } finally {
    await sql.end();
  }
}

/**
 * Courts fixtures (#425, fixtures/courts-data.ts): `chennai-solo`'s parse history for catalogue
 * forums, one `cause_list` document per `adapter_parse_run`. Both tables force row-level security,
 * so the owner writes them in one transaction scoped to the workspace (`app.workspace_id`, as
 * `withWorkspace` sets it). The forums themselves come from the catalogue `migrate.ts` seeded; a
 * catalogue change that breaks what the specs rely on fails here, not in a screenshot. No
 * access-mode registry rows: tests/admin/adapters.spec.ts starts from an empty registry.
 */
async function seedCourtFixtures(): Promise<void> {
  const sql = postgres(databaseUrl(TEMPLATE_DB, 'owner'), { max: 1, onnotice: () => undefined });
  try {
    for (const expected of CATALOGUE_EXPECTATIONS) {
      const [row] = await sql<{ adapter_level: string; enabled: boolean }[]>`
        select adapter_level, enabled from forum
        where workspace_id is null and code = ${expected.code}`;
      if (row?.adapter_level !== expected.adapterLevel || row.enabled !== expected.enabled) {
        throw new Error(
          `e2e: catalogue forum ${expected.code} is ${JSON.stringify(row ?? null)}, the courts ` +
            `fixtures expect ${expected.adapterLevel} ${expected.enabled ? 'enabled' : 'disabled'}`,
        );
      }
    }
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${COURTS_WORKSPACE_ID}, true)`;
      for (const run of COURT_PARSE_RUNS) {
        const sha256 = createHash('sha256').update(run.documentId).digest('hex');
        await tx`
          insert into document (id, workspace_id, kind, storage_key, sha256, created_at, updated_at)
          values (${run.documentId}, ${COURTS_WORKSPACE_ID}, 'cause_list',
                  ${`ws/${COURTS_WORKSPACE_ID}/document/${run.documentId}`}, ${sha256},
                  ${run.createdAt}, ${run.createdAt})`;
        await tx`
          insert into adapter_parse_run (workspace_id, document_id, adapter_id, adapter_version,
            forum_code, rows_parsed, rows_anchored, unmapped_headings, unknown_case_types,
            halls_seen, halls_unreadable, status, created_at)
          values (${COURTS_WORKSPACE_ID}, ${run.documentId}, ${COURTS_ADAPTER_ID},
                  ${COURTS_ADAPTER_VERSION}, ${run.forumCode}, ${run.rowsParsed},
                  ${run.rowsAnchored}, 0, 0, ${run.hallsSeen}::text[],
                  ${run.hallsUnreadable}::text[], ${run.status}, ${run.createdAt})`;
      }
    });
  } finally {
    await sql.end();
  }
}

/** Close every connection to the template and freeze it, so it can be cloned. */
export async function sealTemplateDb(): Promise<void> {
  await admin([
    `alter database ${TEMPLATE_DB} is_template true allow_connections false`,
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${TEMPLATE_DB}' and pid <> pg_backend_pid()`,
  ]);
}

/**
 * Drop the worker's database (closing the web server's connections) and clone it again from the
 * template. Returns the app-role URL and how long the reset took.
 */
export async function resetWorkerDb(workerIndex: number): Promise<{ url: string; ms: number }> {
  const name = assertName(workerDbName(workerIndex));
  const started = performance.now();
  await admin([
    `drop database if exists ${name} with (force)`,
    `create database ${name} template ${TEMPLATE_DB} owner ${ROLES.owner.user}`,
  ]);
  const ms = Math.round(performance.now() - started);
  if (RESET_BUDGET_MS > 0 && ms > RESET_BUDGET_MS) {
    throw new Error(
      `e2e: database reset took ${String(ms)} ms (budget ${String(RESET_BUDGET_MS)} ms)`,
    );
  }
  return { url: databaseUrl(name, 'app'), ms };
}

/** First clone for a worker; same as a reset. */
export const createWorkerDb = resetWorkerDb;

/** Drop every worker clone and, unless `keepTemplate`, the template too. */
export async function dropE2eDatabases({ keepTemplate }: { keepTemplate: boolean }): Promise<void> {
  const sql = postgres(databaseUrl('postgres', 'superuser'), { max: 1, onnotice: () => undefined });
  let names: string[];
  try {
    const rows = await sql<{ datname: string }[]>`
      select datname from pg_database where datname like ${`${DB_PREFIX}\\_w%`}`;
    names = rows.map((r) => r.datname);
  } finally {
    await sql.end();
  }
  for (const name of names) await dropDatabase(name);
  if (!keepTemplate) await dropDatabase(TEMPLATE_DB);
}
