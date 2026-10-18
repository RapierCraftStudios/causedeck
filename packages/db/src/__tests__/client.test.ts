import { inspect } from 'node:util';

import { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createDb } from '../client.ts';
import { runMigrations } from '../migrate.ts';
import { closeTestDb, testAppDb, testDatabaseUrls } from '../testing/index.ts';
import { pgCode, rejection } from './fixtures/index.ts';

afterAll(closeTestDb);

describe('app role (runtime db)', () => {
  it('connects as causedeck_app, which is neither superuser nor owner nor RLS-exempt', async () => {
    const [row] = await testAppDb().execute<{
      u: string;
      su: boolean;
      bypass: boolean;
      owner: string;
    }>(sql`
      select current_user as u, r.rolsuper as su, r.rolbypassrls as bypass,
             (select tableowner from pg_tables where tablename = 'schema_info') as owner
      from pg_roles r where r.rolname = current_user`);
    expect(row).toEqual({ u: 'causedeck_app', su: false, bypass: false, owner: 'causedeck_owner' });
  });

  it.each([
    ['ALTER TABLE', sql`alter table schema_info add column hacked text`],
    ['DROP TABLE', sql`drop table schema_info`],
    ['CREATE TABLE', sql`create table app_made (id int)`],
    ['TRUNCATE', sql`truncate schema_info`],
  ])('cannot %s', async (_label, statement) => {
    const error = await rejection(testAppDb().execute(statement));
    expect(pgCode(error)).toBe('42501'); // insufficient_privilege
  });

  it('can read and write tables the owner created', async () => {
    const rows = await testAppDb().execute<{ n: number }>(
      sql`select count(*)::int as n from schema_info`,
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('credentials never leak', () => {
  const PASSWORD = 's3cr3t-Pa55word';

  function assertClean(error: unknown, ...secrets: string[]) {
    const rendered = [
      String(error),
      inspect(error, { depth: 10 }),
      JSON.stringify(error),
      error instanceof Error ? (error.stack ?? '') : '',
    ].join('\n');
    for (const s of secrets) expect(rendered).not.toContain(s);
  }

  it('redacts an unparseable URL from the error createDb throws', () => {
    const url = `postgres://u:${PASSWORD}@[not-a-host:5432/db`;
    let caught: unknown;
    try {
      createDb({ url: new Secret(url), role: 'app' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    assertClean(caught, PASSWORD, url);
  });

  it('keeps the password out of an authentication failure', async () => {
    const good = new URL(testDatabaseUrls().app);
    good.password = PASSWORD;
    const db = createDb({ url: new Secret(good.toString()), role: 'app', max: 1 });
    try {
      const error = await rejection(db.execute(sql`select 1`));
      expect(pgCode(error)).toBe('28P01'); // invalid_password
      assertClean(error, PASSWORD);
    } finally {
      await db.$client.end();
    }
  });

  it('redacts the owner URL from a failed migration run', async () => {
    const url = `postgres://causedeck_owner:${PASSWORD}@127.0.0.1:1/causedeck`;
    const logged: string[] = [];
    const error = await rejection(
      runMigrations({ url: new Secret(url), logger: { info: (m) => logged.push(m) } }),
    );
    assertClean(error, PASSWORD, url);
    expect(logged.join('\n')).not.toContain(PASSWORD);
  });

  it('a Secret URL renders as [REDACTED] wherever it is logged', () => {
    const secret = new Secret(`postgres://u:${PASSWORD}@h/db`);
    expect(`${String(secret)} ${JSON.stringify({ secret })} ${inspect(secret)}`).not.toContain(
      PASSWORD,
    );
  });
});
