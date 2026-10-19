import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { MIGRATION_LOCK_KEY, MIGRATIONS_FOLDER, runMigrations } from '../migrate.ts';
import { createOwnerDb } from '../owner.ts';
import { createScratchDatabase, testDatabaseUrls } from '../testing/index.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function scratch(name: string) {
  const db = await createScratchDatabase(testDatabaseUrls(), name);
  cleanups.push(db.drop);
  return db;
}

async function query<T extends Record<string, unknown>>(
  url: string,
  statement: ReturnType<typeof sql>,
) {
  const owner = createOwnerDb(new Secret(url));
  try {
    return await owner.execute<T>(statement);
  } finally {
    await owner.$client.end();
  }
}

const journalTags = (): string[] =>
  (
    JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
      entries: { tag: string }[];
    }
  ).entries.map((e) => e.tag);

/** A copy of the migrations folder plus a slow second migration, to widen the race window. */
function migrationsWithSlowStep(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'causedeck-migrations-'));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
  const journalPath = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  };
  const last = journal.entries.at(-1);
  if (!last) throw new Error('empty journal');
  journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag: '9999_slow' });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(
    path.join(dir, '9999_slow.sql'),
    '-- Reviewed-by: test\nselect pg_sleep(0.5);--> statement-breakpoint\ncreate table slow_marker (id int);\n',
  );
  return dir;
}

describe('runMigrations', () => {
  it('applies the baseline as the owner role and logs the applied tag', async () => {
    const db = await scratch('migrate_fresh');
    const logged: string[] = [];
    const result = await runMigrations({
      url: new Secret(db.owner),
      logger: { info: (m) => logged.push(m) },
    });
    expect(result.applied).toEqual(journalTags());
    expect(result.latest).toBe(journalTags().at(-1));
    expect(logged.join('\n')).toContain('0000_baseline');
    expect(logged.join('\n')).not.toContain('causedeck_owner:');

    const [row] = await query<{ owner: string; ext: string[] }>(
      db.owner,
      sql`
      select (select tableowner from pg_tables where tablename = 'schema_info') as owner,
             array(select extname::text from pg_extension order by 1) as ext`,
    );
    expect(row?.owner).toBe('causedeck_owner');
    expect(row?.ext).toEqual(
      expect.arrayContaining(['vector', 'pgcrypto', 'citext', 'pg_trgm', 'unaccent']),
    );

    // 0001: the pgboss schema belongs to the owner; the app role may use it but not create in it.
    const [boss] = await query<{ owner: string; usage: boolean; create: boolean }>(
      db.owner,
      sql`
      select pg_get_userbyid(nspowner) as owner,
             has_schema_privilege('causedeck_app', 'pgboss', 'USAGE') as usage,
             has_schema_privilege('causedeck_app', 'pgboss', 'CREATE') as create
      from pg_namespace where nspname = 'pgboss'`,
    );
    expect(boss).toEqual({ owner: 'causedeck_owner', usage: true, create: false });
  });

  it('creates the Better Auth tables (0002) with uuid ids, workspace FKs and role checks', async () => {
    const db = await scratch('migrate_auth');
    await runMigrations({ url: new Secret(db.owner) });
    const tables = [
      'user',
      'session',
      'account',
      'verification',
      'passkey',
      'two_factor',
      'rate_limit',
      'organization',
      'member',
      'invitation',
    ];

    const rows = await query<{ name: string; owner: string; id_type: string; app_select: boolean }>(
      db.owner,
      sql`
      select t.tablename as name, t.tableowner as owner,
             (select data_type from information_schema.columns c
               where c.table_name = t.tablename and c.column_name = 'id') as id_type,
             has_table_privilege('causedeck_app', format('public.%I', t.tablename), 'SELECT') as app_select
      from pg_tables t where t.schemaname = 'public' and t.tablename in ${tables}
      order by 1`,
    );
    expect(rows).toEqual(
      [...tables]
        .sort()
        .map((name) => ({ name, owner: 'causedeck_owner', id_type: 'uuid', app_select: true })),
    );

    const fks = await query<{ tbl: string; ref: string }>(
      db.owner,
      sql`
      select conrelid::regclass::text as tbl, confrelid::regclass::text as ref
      from pg_constraint
      where contype = 'f' and conrelid::regclass::text in ('member', 'invitation')
        and conkey = array[(select attnum from pg_attribute
          where attrelid = conrelid and attname = 'workspace_id')]
      order by 1`,
    );
    expect(fks).toEqual([
      { tbl: 'invitation', ref: 'organization' },
      { tbl: 'member', ref: 'organization' },
    ]);

    const owner = createOwnerDb(new Secret(db.owner));
    cleanups.push(() => owner.$client.end());
    const [u] = await owner.execute<{ id: string }>(
      sql`insert into "user" (name, email) values ('A', 'a@example.com') returning id`,
    );
    // FORCE RLS (0005) binds the owner too: tenant rows are written inside their workspace.
    const orgId = randomUUID();
    const inWorkspace = (statement: ReturnType<typeof sql>) =>
      owner.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.workspace_id', ${orgId}, true)`);
        return tx.execute(statement);
      });
    await inWorkspace(
      sql`insert into organization (id, name, slug) values (${orgId}, 'Chambers', 'chambers')`,
    );
    const addMember = (role: string) =>
      inWorkspace(
        sql`insert into member (workspace_id, user_id, role) values (${orgId}, ${u?.id}, ${role})`,
      );
    await expect(addMember('admin')).rejects.toThrow();
    await expect(addMember('advocate')).resolves.toBeDefined();
    await expect(
      owner.execute(sql`insert into "user" (name, email) values ('B', 'a@example.com')`),
    ).rejects.toThrow();
  });

  it('is idempotent: a second run applies nothing', async () => {
    const db = await scratch('migrate_twice');
    await runMigrations({ url: new Secret(db.owner) });
    const logged: string[] = [];
    const second = await runMigrations({
      url: new Secret(db.owner),
      logger: { info: (m) => logged.push(m) },
    });
    expect(second.applied).toEqual([]);
    expect(second.latest).toBe(journalTags().at(-1));
    expect(logged).toEqual([`No pending migrations. Latest: ${String(journalTags().at(-1))}.`]);
    const [count] = await query<{ n: number }>(
      db.owner,
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(count?.n).toBe(journalTags().length);
  });

  it('serialises concurrent runs with an advisory lock: each migration applies exactly once', async () => {
    const db = await scratch('migrate_race');
    const folder = migrationsWithSlowStep();
    const runs = await Promise.all(
      Array.from({ length: 3 }, () =>
        runMigrations({ url: new Secret(db.owner), migrationsFolder: folder }),
      ),
    );
    const applied = runs.flatMap((r) => r.applied).sort();
    expect(applied).toEqual([...journalTags(), '9999_slow'].sort());
    expect(runs.filter((r) => r.applied.length > 0)).toHaveLength(1);

    const [rows] = await query<{ n: number; distinct_n: number; info: number }>(
      db.owner,
      sql`
      select count(*)::int as n, count(distinct created_at)::int as distinct_n,
             (select count(*)::int from schema_info) as info
      from drizzle.__drizzle_migrations`,
    );
    expect(rows).toEqual({
      n: journalTags().length + 1,
      distinct_n: journalTags().length + 1,
      info: 1,
    });
  });

  it('holds pg_advisory_lock while migrating and releases it afterwards', async () => {
    const db = await scratch('migrate_lock');
    const folder = migrationsWithSlowStep();
    const running = runMigrations({ url: new Secret(db.owner), migrationsFolder: folder });
    let seen = false;
    for (let i = 0; i < 50 && !seen; i++) {
      const [row] = await query<{ held: boolean }>(
        db.owner,
        sql`
        select exists (select 1 from pg_locks where locktype = 'advisory'
          and ((classid::bigint << 32) | objid::bigint) = ${MIGRATION_LOCK_KEY}) as held`,
      );
      seen = row?.held === true;
      if (!seen) await new Promise((r) => setTimeout(r, 20));
    }
    await running;
    expect(seen).toBe(true);
    const [after] = await query<{ held: boolean }>(
      db.owner,
      sql`
      select exists (select 1 from pg_locks where locktype = 'advisory') as held`,
    );
    expect(after?.held).toBe(false);
  });
});
