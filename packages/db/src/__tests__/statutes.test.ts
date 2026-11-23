// The statute layer (#1123, part 1 of #1116): three global tables (no workspace_id, no RLS) the app
// role may only read, the clerk role not at all; one act key, one section per act, and a section's
// versions never overlap (`statute_section_version_period_excl`, btree_gist over half-open day ranges,
// a null `valid_to` open-ended). No correspondence column: CODE_MAP stays the only mapping table.
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { Secret } from '@causedeck/config/env';
import { getTableColumns, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { GLOBAL_TABLES } from '../conventions.ts';
import { MIGRATIONS_FOLDER } from '../migrate.ts';
import { createOwnerDb } from '../owner.ts';
import { statuteAct, statuteSection, statuteSectionVersion } from '../schema/statutes.ts';
import { testDatabaseUrls } from '../testing/index.ts';
import { sqlState } from './rls/fixtures.ts';

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
afterAll(async () => {
  await owner.$client.end();
});

const TABLES = ['statute_act', 'statute_section', 'statute_section_version'] as const;
const file = readdirSync(MIGRATIONS_FOLDER).find((f) => f.endsWith('_statutes.sql')) ?? '';
const migration = readFileSync(path.join(MIGRATIONS_FOLDER, file), 'utf8');
const names = (table: Parameters<typeof getTableColumns>[0]) =>
  Object.values(getTableColumns(table)).map((c) => c.name);

type OwnerTx = Parameters<Parameters<typeof owner.transaction>[0]>[0];

/** Run `fn` in an owner transaction that is always rolled back. */
async function rolledBack(fn: (tx: OwnerTx) => Promise<void>): Promise<void> {
  const done = new Error('rollback');
  await expect(
    owner.transaction(async (tx) => {
      await fn(tx);
      throw done;
    }),
  ).rejects.toBe(done);
}

describe('statute tables (#1123)', () => {
  it('have the columns of the issue', () => {
    expect(names(statuteAct)).toEqual([
      'id',
      'key',
      'title',
      'short_name',
      'year',
      'in_force_from',
      'source_note',
      'synthetic',
    ]);
    expect(names(statuteSection)).toEqual(['id', 'act_id', 'section', 'heading', 'search_tsv']);
    expect(names(statuteSectionVersion)).toEqual([
      'id',
      'section_id',
      'text',
      'valid_from',
      'valid_to',
      'amended_by',
      'source_note',
      'synthetic',
    ]);
  });

  it('are global: no workspace_id, in GLOBAL_TABLES, no row-level security', async () => {
    for (const table of [statuteAct, statuteSection, statuteSectionVersion]) {
      expect(names(table)).not.toContain('workspace_id');
    }
    for (const name of TABLES) expect(GLOBAL_TABLES).toContain(name);
    const rows = await owner.execute<{ name: string; enabled: boolean }>(sql`
      select relname::text as name, relrowsecurity as enabled from pg_class
       where relname in ('statute_act', 'statute_section', 'statute_section_version')
       order by 1`);
    expect(rows).toEqual(TABLES.map((name) => ({ name, enabled: false })));
  });

  it('carry no correspondence column (CODE_MAP is the only correspondence table)', () => {
    for (const table of [statuteAct, statuteSection, statuteSectionVersion]) {
      for (const name of names(table)) expect(name).not.toMatch(/counterpart|corresponds|maps_to/);
    }
  });

  it('let the app role SELECT only and give the clerk role nothing', async () => {
    for (const table of TABLES) {
      const [row] = await owner.execute<Record<string, boolean>>(sql`
        select has_table_privilege('causedeck_app', ${table}, 'select') as app_select,
               has_table_privilege('causedeck_app', ${table}, 'insert, update, delete, truncate') as app_write,
               has_table_privilege('causedeck_clerk', ${table}, 'select, insert, update, delete') as clerk`);
      expect(row, table).toEqual({ app_select: true, app_write: false, clerk: false });
    }
    expect(migration).toMatch(
      /REVOKE ALL ON "statute_act", "statute_section", "statute_section_version" FROM PUBLIC, causedeck_app, causedeck_clerk/,
    );
    expect(migration).toMatch(
      /GRANT SELECT ON "statute_act", "statute_section", "statute_section_version" TO causedeck_app;/,
    );
    expect(migration).not.toMatch(/ROW LEVEL SECURITY/);
  });

  it('declares the keys, the period check and the exclusion constraint', async () => {
    const rows = await owner.execute<{ name: string; def: string }>(sql`
      select conname::text as name, pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid in ('statute_act'::regclass, 'statute_section'::regclass,
                          'statute_section_version'::regclass)
         and contype in ('u', 'c', 'x')
       order by 1`);
    expect(Object.fromEntries(rows.map((r) => [r.name, r.def]))).toEqual({
      statute_act_key_uq: 'UNIQUE (key)',
      statute_section_version_period_check:
        'CHECK (((valid_to IS NULL) OR (valid_to > valid_from)))',
      statute_section_version_period_excl:
        "EXCLUDE USING gist (section_id WITH =, daterange(valid_from, valid_to, '[)'::text) WITH &&)",
    });
    const [uq] = await owner.execute<{ def: string }>(
      sql`select indexdef as def from pg_indexes where indexname = 'statute_section_act_section_uq'`,
    );
    expect(uq?.def).toMatch(/UNIQUE INDEX .* \(act_id, section\)/);
  });
});

describe('statute section history (#1123)', () => {
  async function newSections(tx: OwnerTx) {
    const tag = randomUUID().slice(0, 8);
    const [act] = await tx
      .insert(statuteAct)
      .values({
        key: `test act ${tag}`,
        title: `Test Act ${tag}`,
        inForceFrom: '2000-01-01',
        sourceNote: 'test',
        synthetic: true,
      })
      .returning({ id: statuteAct.id });
    if (act === undefined) throw new Error('act insert failed');
    const sections = await tx
      .insert(statuteSection)
      .values([
        { actId: act.id, section: '1', heading: 'One' },
        { actId: act.id, section: '2', heading: 'Two' },
      ])
      .returning({ id: statuteSection.id });
    const [a, b] = sections;
    if (a === undefined || b === undefined) throw new Error('section insert failed');
    return { actId: act.id, a: a.id, b: b.id };
  }

  const version = (sectionId: string, validFrom: string, validTo: string | null) => ({
    sectionId,
    text: 'SYNTHETIC test text',
    validFrom,
    validTo,
    sourceNote: 'test',
    synthetic: true,
  });

  it('rejects overlapping versions of one section and accepts adjacent ones', async () => {
    await rolledBack(async (tx) => {
      const { a, b } = await newSections(tx);
      await tx.insert(statuteSectionVersion).values(version(a, '2000-01-01', '2010-01-01'));
      // Half-open ranges: a version may start the day the previous one ends.
      await tx.insert(statuteSectionVersion).values(version(a, '2010-01-01', null));
      // The same range on another section is fine.
      await tx.insert(statuteSectionVersion).values(version(b, '2000-01-01', '2010-01-01'));
      const insert = (row: ReturnType<typeof version>) =>
        tx.transaction(async (sp) => {
          await sp.insert(statuteSectionVersion).values(row);
        });
      expect(await sqlState(insert(version(a, '2005-01-01', '2006-01-01')))).toBe('23P01');
      // The open-ended version overlaps anything after it starts.
      expect(await sqlState(insert(version(a, '2030-01-01', '2031-01-01')))).toBe('23P01');
      expect(await sqlState(insert(version(b, '1999-01-01', null)))).toBe('23P01');
    });
  });

  it('rejects an empty or reversed range, a duplicate act key and a duplicate section', async () => {
    await rolledBack(async (tx) => {
      const { actId, a } = await newSections(tx);
      const attempt = (fn: (sp: OwnerTx) => Promise<unknown>) =>
        tx.transaction(async (sp) => {
          await fn(sp);
        });
      expect(
        await sqlState(
          attempt((sp) =>
            sp.insert(statuteSectionVersion).values(version(a, '2010-01-01', '2010-01-01')),
          ),
        ),
      ).toBe('23514');
      expect(
        await sqlState(
          attempt((sp) => sp.insert(statuteSection).values({ actId, section: '1', heading: 'x' })),
        ),
      ).toBe('23505');
      const [row] = await tx
        .select({ key: statuteAct.key })
        .from(statuteAct)
        .where(sql`${statuteAct.id} = ${actId}`);
      expect(
        await sqlState(
          attempt((sp) =>
            sp.insert(statuteAct).values({
              key: row?.key ?? '',
              title: 'dup',
              inForceFrom: '2000-01-01',
              sourceNote: 'test',
              synthetic: true,
            }),
          ),
        ),
      ).toBe('23505');
    });
  });
});
