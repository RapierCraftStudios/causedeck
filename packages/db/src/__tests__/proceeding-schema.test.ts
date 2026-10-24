// Proceedings (#346, part 3 of #32): `proceeding` and `proceeding_link` are tenant tables under
// FORCE RLS with composite (workspace_id, <parent>_id) FKs and provenance; the case identity and
// pre-numbering CHECKs and unique indexes; `forum_id` scope-guarded to a catalogue or own forum;
// the `parent_of` cycle guard; and migration 0039 applying on top of 0038.
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Secret } from '@causedeck/config/env';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Transaction } from '../client.ts';
import { MIGRATIONS_FOLDER, runMigrations } from '../migrate.ts';
import { createOwnerDb } from '../owner.ts';
import { forum } from '../schema/court.ts';
import { anchor, document } from '../schema/documents.ts';
import { matter } from '../schema/matter-graph.ts';
import { proceeding, proceedingLink } from '../schema/proceedings.ts';
import {
  createScratchDatabase,
  inWorkspace,
  testDatabaseUrls,
  withTestDb,
} from '../testing/index.ts';
import { newWorkspace, sqlState } from './rls/fixtures.ts';

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
const TAG = randomUUID().slice(0, 8);
const catalogue = { forumId: '' };

beforeAll(async () => {
  // A committed catalogue forum (null workspace_id): only the owner role may write it.
  const [f] = await owner
    .insert(forum)
    .values({
      code: `test.proceeding.${TAG}`,
      court: 'Test High Court',
      jurisdictionKind: 'high_court',
    })
    .returning({ id: forum.id });
  if (f === undefined) throw new Error('catalogue forum insert failed');
  catalogue.forumId = f.id;
});

afterAll(async () => {
  await owner.delete(forum).where(eq(forum.id, catalogue.forumId));
  await owner.$client.end();
});

const TABLES = ['proceeding', 'proceeding_link'] as const;

/** The SQLSTATE of `fn` run in a savepoint (null when it succeeds). */
const stateOf = (s: Transaction, fn: (sp: Transaction) => Promise<unknown>) =>
  sqlState(s.transaction(fn));

interface Parents {
  matterId: string;
  forumId: string;
}

/** A matter and a custom forum of the workspace. */
async function newParents(s: Transaction, workspaceId: string): Promise<Parents> {
  const [m] = await s
    .insert(matter)
    .values({ workspaceId, title: 'Petitioner v. State' })
    .returning({ id: matter.id });
  const [f] = await s
    .insert(forum)
    .values({
      workspaceId,
      code: `custom.${randomUUID().slice(0, 8)}`,
      court: 'Custom District Court',
      jurisdictionKind: 'district',
    })
    .returning({ id: forum.id });
  if (m === undefined || f === undefined) throw new Error('parent insert returned no row');
  return { matterId: m.id, forumId: f.id };
}

async function newProceeding(
  s: Transaction,
  workspaceId: string,
  parents: Parents,
  values: Partial<typeof proceeding.$inferInsert> = {},
): Promise<string> {
  const [row] = await s
    .insert(proceeding)
    .values({
      workspaceId,
      ...parents,
      caseTypeCode: 'WP',
      caseTypeRaw: 'W.P.',
      sourceType: 'manual',
      ...values,
    })
    .returning({ id: proceeding.id });
  if (row === undefined) throw new Error('proceeding insert returned no row');
  return row.id;
}

async function newLink(
  s: Transaction,
  workspaceId: string,
  from: string,
  to: string,
  values: Partial<typeof proceedingLink.$inferInsert> = {},
): Promise<string> {
  const [row] = await s
    .insert(proceedingLink)
    .values({
      workspaceId,
      fromProceedingId: from,
      toProceedingId: to,
      kind: 'parent_of',
      sourceType: 'manual',
      ...values,
    })
    .returning({ id: proceedingLink.id });
  if (row === undefined) throw new Error('proceeding_link insert returned no row');
  return row.id;
}

async function newAnchor(s: Transaction, workspaceId: string, matterId: string): Promise<string> {
  const [d] = await s
    .insert(document)
    .values({
      workspaceId,
      matterId,
      kind: 'order',
      storageKey: `ws/${workspaceId}/document/${randomUUID()}`,
      sha256: 'b'.repeat(64),
    })
    .returning({ id: document.id });
  const [a] = await s
    .insert(anchor)
    .values({ workspaceId, documentId: d?.id ?? '', pageNo: 1, quote: 'q', kind: 'document' })
    .returning({ id: anchor.id });
  if (a === undefined) throw new Error('anchor insert returned no row');
  return a.id;
}

describe('proceeding tables in the catalog (#346)', () => {
  it('are under FORCE RLS with exactly ws_isolation, and granted to the app and clerk roles', async () => {
    for (const table of TABLES) {
      const [row] = await owner.execute<{
        enabled: boolean;
        forced: boolean;
        policies: string[];
        app: boolean;
        clerk: boolean;
      }>(sql`
        select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
               array(select polname::text from pg_policy where polrelid = c.oid order by 1) as policies,
               has_table_privilege('causedeck_app', c.oid, 'select, insert, update, delete') as app,
               has_table_privilege('causedeck_clerk', c.oid, 'select, insert, update, delete') as clerk
          from pg_class c where c.relname = ${table} and c.relnamespace = 'public'::regnamespace`);
      expect(row, table).toEqual({
        enabled: true,
        forced: true,
        // proceeding also carries the owner-only definer read that app_board_poll_targets (0074, #493) needs.
        policies:
          table === 'proceeding' ? ['owner_definer_read', 'ws_isolation'] : ['ws_isolation'],
        app: true,
        clerk: true,
      });
    }
  });

  it('has composite tenant FKs, a scope-guarded forum FK and the cycle guard', async () => {
    const rows = await owner.execute<{ name: string; def: string }>(sql`
      select conname::text as name, pg_get_constraintdef(oid) as def from pg_constraint
      where contype = 'f' and conrelid in ('proceeding'::regclass, 'proceeding_link'::regclass)
        and conname not like '%workspace_id_fk'
      order by 1`);
    expect(Object.fromEntries(rows.map((r) => [r.name, r.def]))).toEqual({
      proceeding_anchor_fk:
        'FOREIGN KEY (workspace_id, anchor_id) REFERENCES anchor(workspace_id, id)',
      proceeding_forum_id_forum_id_fk:
        'FOREIGN KEY (forum_id) REFERENCES forum(id) ON DELETE RESTRICT',
      proceeding_link_anchor_fk:
        'FOREIGN KEY (workspace_id, anchor_id) REFERENCES anchor(workspace_id, id)',
      proceeding_link_from_fk:
        'FOREIGN KEY (workspace_id, from_proceeding_id) REFERENCES proceeding(workspace_id, id) ON DELETE CASCADE',
      proceeding_link_to_fk:
        'FOREIGN KEY (workspace_id, to_proceeding_id) REFERENCES proceeding(workspace_id, id) ON DELETE CASCADE',
      proceeding_matter_fk:
        'FOREIGN KEY (workspace_id, matter_id) REFERENCES matter(workspace_id, id)',
      proceeding_parent_fk:
        'FOREIGN KEY (workspace_id, parent_proceeding_id) REFERENCES proceeding(workspace_id, id) ON DELETE SET NULL (parent_proceeding_id)',
    });
    const triggers = await owner.execute<{ name: string }>(sql`
      select tgname::text as name from pg_trigger
      where tgrelid in ('proceeding'::regclass, 'proceeding_link'::regclass) and not tgisinternal
      order by 1`);
    expect(triggers.map((t) => t.name)).toEqual([
      'proceeding_forum_id_scope_guard',
      'proceeding_link_parent_of_cycle_guard',
    ]);
  });

  it('keeps the pre-numbering identifiers in separate nullable text columns', async () => {
    const rows = await owner.execute<{ name: string; type: string; nullable: string }>(sql`
      select column_name::text as name, data_type::text as type, is_nullable::text as nullable
        from information_schema.columns
       where table_schema = 'public' and table_name = 'proceeding'
         and column_name in ('sr_no', 'fr_no', 'diary_no', 'cnr', 'filing_no', 'number', 'year', 'state')
       order by 1`);
    expect(rows).toEqual([
      { name: 'cnr', type: 'text', nullable: 'YES' },
      { name: 'diary_no', type: 'text', nullable: 'YES' },
      { name: 'filing_no', type: 'text', nullable: 'YES' },
      { name: 'fr_no', type: 'text', nullable: 'YES' },
      { name: 'number', type: 'text', nullable: 'YES' },
      { name: 'sr_no', type: 'text', nullable: 'YES' },
      { name: 'state', type: 'USER-DEFINED', nullable: 'NO' },
      { name: 'year', type: 'integer', nullable: 'YES' },
    ]);
    const [states] = await owner.execute<{ labels: string[] }>(sql`
      select array(select enumlabel::text from pg_enum where enumtypid = 'proceeding_state'::regtype
                   order by enumsortorder) as labels`);
    expect(states?.labels).toEqual([
      'filed',
      'sr_fr',
      'defects',
      're_presented',
      'numbered',
      'disposed',
    ]);
  });
});

describe('proceeding (#346)', () => {
  it('needs number and year from numbered on; earlier stages carry SR, FR, diary and filing numbers', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const parents = await newParents(s, id);
        const pid = await newProceeding(s, id, parents, {
          filingNo: '1234/2026',
          srNo: 'SR 5678',
          frNo: 'FR 12',
          diaryNo: 'D-99',
        });
        const [row] = await s.select().from(proceeding).where(eq(proceeding.id, pid));
        expect(row).toMatchObject({ state: 'filed', kind: 'main', number: null, year: null });
        for (const state of ['sr_fr', 'defects', 're_presented'] as const) {
          await s.update(proceeding).set({ state }).where(eq(proceeding.id, pid));
        }
        expect(
          await stateOf(s, (sp) =>
            sp.update(proceeding).set({ state: 'numbered' }).where(eq(proceeding.id, pid)),
          ),
        ).toBe('23514');
        expect(
          await stateOf(s, (sp) =>
            sp
              .update(proceeding)
              .set({ state: 'numbered', number: '4521' })
              .where(eq(proceeding.id, pid)),
          ),
        ).toBe('23514');
        await s
          .update(proceeding)
          .set({ state: 'numbered', number: '4521', year: 2026 })
          .where(eq(proceeding.id, pid));
        await s.update(proceeding).set({ state: 'disposed' }).where(eq(proceeding.id, pid));
        expect(
          await stateOf(s, (sp) =>
            sp.update(proceeding).set({ year: null }).where(eq(proceeding.id, pid)),
          ),
        ).toBe('23514');
        expect(
          await stateOf(s, (sp) =>
            sp.execute(sql`update proceeding set state = 'pending' where id = ${pid}`),
          ),
        ).toBe('22P02');
      });
    });
  });

  it('is unique per forum, case type, number and year once numbered, and per CNR', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const numbered = { state: 'numbered' as const, number: '100', year: 2025 };
      await inWorkspace(tx, a.id, async (s) => {
        const parents = await newParents(s, a.id);
        await newProceeding(s, a.id, parents, numbered);
        expect(await stateOf(s, (sp) => newProceeding(sp, a.id, parents, numbered))).toBe('23505');
        // Another year, case type or forum is another case.
        await newProceeding(s, a.id, parents, { ...numbered, year: 2024 });
        await newProceeding(s, a.id, parents, { ...numbered, caseTypeCode: 'WMP' });
        await newProceeding(s, a.id, { ...parents, forumId: catalogue.forumId }, numbered);
        // Un-numbered proceedings do not collide.
        await newProceeding(s, a.id, parents);
        await newProceeding(s, a.id, parents);

        await newProceeding(s, a.id, parents, { cnr: 'TNHC010012342025' });
        expect(
          await stateOf(s, (sp) => newProceeding(sp, a.id, parents, { cnr: 'TNHC010012342025' })),
        ).toBe('23505');
        for (const cnr of [
          'tnhc010012342025',
          'TNHC01001234202',
          'TNHC0100123420255',
          'TNHC-1001234202',
        ]) {
          expect(await stateOf(s, (sp) => newProceeding(sp, a.id, parents, { cnr })), cnr).toBe(
            '23514',
          );
        }
      });
      // The identity is per workspace: B can track the same case.
      await inWorkspace(tx, b.id, async (s) => {
        const parents = await newParents(s, b.id);
        await newProceeding(s, b.id, { ...parents, forumId: catalogue.forumId }, numbered);
        await newProceeding(s, b.id, parents, { cnr: 'TNHC010012342025' });
      });
    });
  });

  it('stores case_type_code normalised, with the printed label in case_type_raw', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const parents = await newParents(s, id);
        const pid = await newProceeding(s, id, parents, {
          caseTypeCode: 'CRLOP',
          caseTypeRaw: 'Crl.O.P.',
        });
        const [row] = await s.select().from(proceeding).where(eq(proceeding.id, pid));
        expect(row).toMatchObject({ caseTypeCode: 'CRLOP', caseTypeRaw: 'Crl.O.P.' });
        for (const caseTypeCode of ['W.P.', 'wp', 'W P', 'WP\t', '']) {
          expect(
            await stateOf(s, (sp) => newProceeding(sp, id, parents, { caseTypeCode })),
            caseTypeCode,
          ).toBe('23514');
        }
      });
    });
  });

  it('references a catalogue forum or its own, never another workspace forum', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const bForum = await inWorkspace(tx, b.id, async (s) => (await newParents(s, b.id)).forumId);
      await inWorkspace(tx, a.id, async (s) => {
        const parents = await newParents(s, a.id);
        await newProceeding(s, a.id, parents);
        const pid = await newProceeding(s, a.id, { ...parents, forumId: catalogue.forumId });
        expect(
          await stateOf(s, (sp) => newProceeding(sp, a.id, { ...parents, forumId: bForum })),
        ).toBe('23503');
        expect(
          await stateOf(s, (sp) =>
            sp.update(proceeding).set({ forumId: bForum }).where(eq(proceeding.id, pid)),
          ),
        ).toBe('23503');
      });
    });
  });

  it('rejects a matter of another workspace with a FK violation, even for the table owner', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const bMatter = await inWorkspace(
        tx,
        b.id,
        async (s) => (await newParents(s, b.id)).matterId,
      );
      await inWorkspace(tx, a.id, async (s) => {
        const parents = await newParents(s, a.id);
        expect(
          await stateOf(s, (sp) => newProceeding(sp, a.id, { ...parents, matterId: bMatter })),
        ).toBe('23503');
      });
    });
    // The owner role is not exempt: the composite key, not RLS, rejects the other workspace's matter.
    const a = await owner.transaction((o) => newWorkspaceAsOwner(o));
    try {
      const b = await owner.transaction((o) => newWorkspaceAsOwner(o));
      try {
        const bMatter = await owner.transaction(async (o) => {
          await o.execute(sql`select set_config('app.workspace_id', ${b.id}, true)`);
          return (await newParents(o, b.id)).matterId;
        });
        await owner.transaction(async (o) => {
          await o.execute(sql`select set_config('app.workspace_id', ${a.id}, true)`);
          const parents = await newParents(o, a.id);
          await newProceeding(o, a.id, parents);
          expect(
            await stateOf(o, (sp) => newProceeding(sp, a.id, { ...parents, matterId: bMatter })),
          ).toBe('23503');
        });
      } finally {
        await dropWorkspaceAsOwner(b.id);
      }
    } finally {
      await dropWorkspaceAsOwner(a.id);
    }
  });

  it('nulls a child parent_proceeding_id when its main proceeding goes, and drops its links', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const parents = await newParents(s, id);
        const main = await newProceeding(s, id, parents);
        const misc = await newProceeding(s, id, parents, {
          kind: 'misc',
          caseTypeCode: 'WMP',
          parentProceedingId: main,
        });
        await newLink(s, id, main, misc);
        expect(
          await stateOf(s, (sp) =>
            sp.update(proceeding).set({ parentProceedingId: main }).where(eq(proceeding.id, main)),
          ),
        ).toBe('23514');
        await s.delete(proceeding).where(eq(proceeding.id, main));
        const [row] = await s.select().from(proceeding).where(eq(proceeding.id, misc));
        expect(row).toMatchObject({ workspaceId: id, parentProceedingId: null });
        expect(await s.select().from(proceedingLink)).toEqual([]);
      });
    });
  });
});

describe('provenance on proceeding and proceeding_link (#346)', () => {
  it('rejects a non-manual row with neither anchor_id nor source_ref', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const parents = await newParents(s, id);
        const anchorId = await newAnchor(s, id, parents.matterId);
        const p1 = await newProceeding(s, id, parents);
        const p2 = await newProceeding(s, id, parents);

        expect(await stateOf(s, (sp) => newProceeding(sp, id, parents, { sourceType: 'ai' }))).toBe(
          '23514',
        );
        expect(await stateOf(s, (sp) => newLink(sp, id, p1, p2, { sourceType: 'adapter' }))).toBe(
          '23514',
        );

        await newProceeding(s, id, parents, { sourceType: 'ai', anchorId, confidence: '0.900' });
        await newProceeding(s, id, parents, { sourceType: 'adapter', sourceRef: 'ecourts:case' });
        await newLink(s, id, p1, p2, { sourceType: 'document', anchorId });
        await newLink(s, id, p1, p2, {
          kind: 'connected',
          sourceType: 'import',
          sourceRef: 'csv:1',
        });
        expect(
          await stateOf(s, (sp) =>
            newProceeding(sp, id, parents, { sourceType: 'ai', anchorId, confidence: '1.500' }),
          ),
        ).toBe('23514');
      });
    });
  });
});

describe('proceeding_link (#346)', () => {
  it('rejects self-links, duplicate triples and unknown kinds', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const parents = await newParents(s, id);
        const p1 = await newProceeding(s, id, parents);
        const p2 = await newProceeding(s, id, parents);
        expect(await stateOf(s, (sp) => newLink(sp, id, p1, p1, { kind: 'connected' }))).toBe(
          '23514',
        );
        for (const kind of ['parent_of', 'connected', 'appeal_from', 'lower_court'] as const) {
          await newLink(s, id, p1, p2, { kind });
        }
        expect(await stateOf(s, (sp) => newLink(sp, id, p1, p2, { kind: 'connected' }))).toBe(
          '23505',
        );
        expect(
          await stateOf(s, (sp) =>
            sp.execute(
              sql`insert into proceeding_link (workspace_id, from_proceeding_id, to_proceeding_id, kind, source_type) values (${id}, ${p2}, ${p1}, 'sibling', 'manual')`,
            ),
          ),
        ).toBe('23514');
      });
    });
  });

  it('rejects a parent_of link that closes a 3-node cycle, by insert or by update', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const parents = await newParents(s, id);
        const [a, b, c, d] = [
          await newProceeding(s, id, parents),
          await newProceeding(s, id, parents),
          await newProceeding(s, id, parents),
          await newProceeding(s, id, parents),
        ];
        await newLink(s, id, a, b);
        await newLink(s, id, b, c);
        // C -> A would close A -> B -> C -> A; B -> A a 2-node cycle.
        expect(await stateOf(s, (sp) => newLink(sp, id, c, a))).toBe('23514');
        expect(await stateOf(s, (sp) => newLink(sp, id, b, a))).toBe('23514');
        // Acyclic shapes pass: a second child, a diamond, and other kinds back up the chain.
        await newLink(s, id, a, c);
        await newLink(s, id, c, d);
        await newLink(s, id, a, d);
        const back = await newLink(s, id, c, a, { kind: 'connected' });
        await newLink(s, id, d, a, { kind: 'appeal_from' });
        // Turning the back link into parent_of, or re-pointing an edge, closes a cycle too.
        expect(
          await stateOf(s, (sp) =>
            sp.update(proceedingLink).set({ kind: 'parent_of' }).where(eq(proceedingLink.id, back)),
          ),
        ).toBe('23514');
        // A -> B re-pointed as D -> B closes B -> C -> D -> B.
        const [ab] = await s
          .select({ id: proceedingLink.id })
          .from(proceedingLink)
          .where(sql`from_proceeding_id = ${a} and to_proceeding_id = ${b} and kind = 'parent_of'`);
        expect(
          await stateOf(s, (sp) =>
            sp
              .update(proceedingLink)
              .set({ fromProceedingId: d })
              .where(eq(proceedingLink.id, ab?.id ?? '')),
          ),
        ).toBe('23514');
      });
    });
  });
});

/** A committed workspace with one owner member, written as the owner role (FORCE RLS binds it). */
async function newWorkspaceAsOwner(o: Transaction): Promise<{ id: string }> {
  const id = randomUUID();
  await o.execute(sql`select set_config('app.workspace_id', ${id}, true)`);
  const [u] = await o.execute<{ id: string }>(
    sql`insert into "user" (name, email) values ('Owner', ${`${id}@example.test`}) returning id`,
  );
  await o.execute(
    sql`insert into organization (id, name, slug) values (${id}, 'Chambers', ${`pr-${id}`})`,
  );
  await o.execute(
    sql`insert into member (workspace_id, user_id, role) values (${id}, ${u?.id ?? ''}, 'owner')`,
  );
  return { id };
}

async function dropWorkspaceAsOwner(id: string): Promise<void> {
  await owner.transaction(async (o) => {
    await o.execute(sql`select set_config('app.workspace_id', ${id}, true)`);
    const users = await o.execute<{ id: string }>(
      sql`select user_id as id from member where workspace_id = ${id}`,
    );
    await o.execute(sql`delete from organization where id = ${id}`);
    for (const u of users) await o.execute(sql`delete from "user" where id = ${u.id}`);
  });
}

describe('migration 0039', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterAll(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('applies on a database migrated through 0038', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'causedeck-0038-'));
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
    const journalPath = path.join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    const head = journal.entries.findIndex((e) => e.tag === '0038_matter_documents');
    expect(head).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, head + 1);
    writeFileSync(journalPath, JSON.stringify(journal));

    const db = await createScratchDatabase(testDatabaseUrls(), 'proceeding_0038');
    cleanups.push(db.drop);
    const before = await runMigrations({ url: new Secret(db.owner), migrationsFolder: dir });
    expect(before.latest).toBe('0038_matter_documents');

    const scratch = createOwnerDb(new Secret(db.owner));
    cleanups.push(() => scratch.$client.end());
    // A matter written before proceedings existed stays and can take a proceeding afterwards.
    const ws = await scratch.transaction(async (o) => {
      const { id } = await newWorkspaceAsOwner(o);
      return { id, parents: await newParents(o, id) };
    });

    const after = await runMigrations({ url: new Secret(db.owner) });
    expect(after.applied[0]).toBe('0039_proceedings');
    await scratch.transaction(async (o) => {
      await o.execute(sql`select set_config('app.workspace_id', ${ws.id}, true)`);
      const p1 = await newProceeding(o, ws.id, ws.parents);
      const p2 = await newProceeding(o, ws.id, ws.parents);
      await newLink(o, ws.id, p1, p2);
      expect(await stateOf(o, (sp) => newLink(sp, ws.id, p2, p1))).toBe('23514');
    });
  }, 240_000);
});
