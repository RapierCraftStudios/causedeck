// People (#348, part 5 of #32): `person`, `organisation` and `role_edge` are tenant tables under
// FORCE RLS with composite (workspace_id, <parent>_id) FKs; provenance on `person` and `role_edge`;
// contact details only for clients and professionals; a role edge has exactly one target and dies
// with either end; and migration 0040 applying on top of 0039.
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Secret } from '@causedeck/config/env';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import type { Transaction } from '../client.ts';
import { MIGRATIONS_FOLDER, runMigrations } from '../migrate.ts';
import { createOwnerDb } from '../owner.ts';
import { forum } from '../schema/court.ts';
import { anchor, document } from '../schema/documents.ts';
import { matter } from '../schema/matter-graph.ts';
import { organisation, person, roleEdge } from '../schema/people.ts';
import { proceeding } from '../schema/proceedings.ts';
import {
  createScratchDatabase,
  inWorkspace,
  testDatabaseUrls,
  withTestDb,
} from '../testing/index.ts';
import { newWorkspace, sqlState } from './rls/fixtures.ts';

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));

afterAll(async () => {
  await owner.$client.end();
});

const TABLES = ['person', 'organisation', 'role_edge'] as const;

/** The SQLSTATE of `fn` run in a savepoint (null when it succeeds). */
const stateOf = (s: Transaction, fn: (sp: Transaction) => Promise<unknown>) =>
  sqlState(s.transaction(fn));

async function newPerson(
  s: Transaction,
  workspaceId: string,
  values: Partial<typeof person.$inferInsert> = {},
): Promise<string> {
  const [row] = await s
    .insert(person)
    .values({ workspaceId, name: 'A. Petitioner', kind: 'party', sourceType: 'manual', ...values })
    .returning({ id: person.id });
  if (row === undefined) throw new Error('person insert returned no row');
  return row.id;
}

async function newEdge(
  s: Transaction,
  workspaceId: string,
  fromPersonId: string,
  values: Partial<typeof roleEdge.$inferInsert> = {},
): Promise<string> {
  const [row] = await s
    .insert(roleEdge)
    .values({ workspaceId, kind: 'represents', fromPersonId, sourceType: 'manual', ...values })
    .returning({ id: roleEdge.id });
  if (row === undefined) throw new Error('role_edge insert returned no row');
  return row.id;
}

interface Graph {
  matterId: string;
  proceedingId: string;
  anchorId: string;
}

/** A matter with one proceeding before a custom forum, and an anchor in one of its documents. */
async function newGraph(s: Transaction, workspaceId: string): Promise<Graph> {
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
  const [p] = await s
    .insert(proceeding)
    .values({
      workspaceId,
      matterId: m.id,
      forumId: f.id,
      caseTypeCode: 'WP',
      sourceType: 'manual',
    })
    .returning({ id: proceeding.id });
  const [d] = await s
    .insert(document)
    .values({
      workspaceId,
      matterId: m.id,
      kind: 'pleading',
      storageKey: `ws/${workspaceId}/document/${randomUUID()}`,
      sha256: 'c'.repeat(64),
    })
    .returning({ id: document.id });
  const [a] = await s
    .insert(anchor)
    .values({ workspaceId, documentId: d?.id ?? '', pageNo: 1, quote: 'q', kind: 'document' })
    .returning({ id: anchor.id });
  if (p === undefined || a === undefined) throw new Error('graph insert returned no row');
  return { matterId: m.id, proceedingId: p.id, anchorId: a.id };
}

describe('people tables in the catalog (#348)', () => {
  it('are under FORCE RLS with exactly ws_isolation, and granted to the app and clerk roles', async () => {
    for (const table of TABLES) {
      const [row] = await owner.execute<{
        enabled: boolean;
        forced: boolean;
        policies: string[];
        workspaceNotNull: boolean;
        app: boolean;
        clerk: boolean;
      }>(sql`
        select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
               array(select polname::text from pg_policy where polrelid = c.oid order by 1) as policies,
               (select attnotnull from pg_attribute where attrelid = c.oid and attname = 'workspace_id') as "workspaceNotNull",
               has_table_privilege('causedeck_app', c.oid, 'select, insert, update, delete') as app,
               has_table_privilege('causedeck_clerk', c.oid, 'select, insert, update, delete') as clerk
          from pg_class c where c.relname = ${table} and c.relnamespace = 'public'::regnamespace`);
      expect(row, table).toEqual({
        enabled: true,
        forced: true,
        policies: ['ws_isolation'],
        workspaceNotNull: true,
        app: true,
        clerk: true,
      });
    }
  });

  it('has composite tenant FKs only', async () => {
    const rows = await owner.execute<{ name: string; def: string }>(sql`
      select conname::text as name, pg_get_constraintdef(oid) as def from pg_constraint
      where contype = 'f'
        and conrelid in ('person'::regclass, 'organisation'::regclass, 'role_edge'::regclass)
        and conname not like '%workspace_id_fk'
      order by 1`);
    expect(Object.fromEntries(rows.map((r) => [r.name, r.def]))).toEqual({
      person_anchor_fk: 'FOREIGN KEY (workspace_id, anchor_id) REFERENCES anchor(workspace_id, id)',
      role_edge_anchor_fk:
        'FOREIGN KEY (workspace_id, anchor_id) REFERENCES anchor(workspace_id, id)',
      role_edge_from_person_fk:
        'FOREIGN KEY (workspace_id, from_person_id) REFERENCES person(workspace_id, id) ON DELETE CASCADE',
      role_edge_matter_fk:
        'FOREIGN KEY (workspace_id, matter_id) REFERENCES matter(workspace_id, id) ON DELETE CASCADE',
      role_edge_proceeding_fk:
        'FOREIGN KEY (workspace_id, proceeding_id) REFERENCES proceeding(workspace_id, id) ON DELETE CASCADE',
      role_edge_to_person_fk:
        'FOREIGN KEY (workspace_id, to_person_id) REFERENCES person(workspace_id, id) ON DELETE CASCADE',
    });
  });
});

describe('person and organisation (#348)', () => {
  it('keeps contact details only for clients and professionals, and needs a name', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const contact = { email: 'client@example.test' };
        expect(await stateOf(s, (sp) => newPerson(sp, id, { kind: 'party', contact }))).toBe(
          '23514',
        );
        expect(await stateOf(s, (sp) => newPerson(sp, id, { kind: 'advocate', contact }))).toBe(
          '23514',
        );
        expect(await stateOf(s, (sp) => newPerson(sp, id, { name: '  ' }))).toBe('23514');
        const client = await newPerson(s, id, { kind: 'client', contact });
        await newPerson(s, id, { kind: 'professional', contact: { phone: '+91 00000 00000' } });
        const party = await newPerson(s, id, { aliases: ['A.P.', 'Petitioner No. 1'] });
        const rows = await s.select().from(person);
        expect(rows.find((r) => r.id === client)).toMatchObject({ contact, aliases: [] });
        expect(rows.find((r) => r.id === party)).toMatchObject({
          contact: null,
          aliases: ['A.P.', 'Petitioner No. 1'],
        });

        expect(
          await stateOf(s, (sp) => sp.insert(organisation).values({ workspaceId: id, name: '' })),
        ).toBe('23514');
        const [org] = await s
          .insert(organisation)
          .values({ workspaceId: id, name: 'Fictional & Co.' })
          .returning();
        expect(org).toMatchObject({ workspaceId: id, aliases: [] });
      });
    });
  });
});

describe('provenance on person and role_edge (#348)', () => {
  it('rejects a non-manual row with neither anchor_id nor source_ref', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const { matterId, anchorId } = await newGraph(s, id);
        const from = await newPerson(s, id, { kind: 'advocate' });

        expect(await stateOf(s, (sp) => newPerson(sp, id, { sourceType: 'ai' }))).toBe('23514');
        expect(
          await stateOf(s, (sp) => newEdge(sp, id, from, { matterId, sourceType: 'adapter' })),
        ).toBe('23514');

        await newPerson(s, id, { sourceType: 'ai', anchorId, confidence: '0.800' });
        await newPerson(s, id, { sourceType: 'adapter', sourceRef: 'ecourts:party' });
        await newEdge(s, id, from, { matterId, sourceType: 'document', anchorId });
        await newEdge(s, id, from, { matterId, sourceType: 'import', sourceRef: 'csv:1' });
        expect(
          await stateOf(s, (sp) =>
            newEdge(sp, id, from, { matterId, sourceType: 'ai', anchorId, confidence: '1.200' }),
          ),
        ).toBe('23514');
      });
    });
  });
});

describe('role_edge (#348)', () => {
  it('has exactly one target and never points a person at itself', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const { matterId, proceedingId } = await newGraph(s, id);
        const advocate = await newPerson(s, id, { kind: 'advocate' });
        const client = await newPerson(s, id, { kind: 'client' });

        expect(await stateOf(s, (sp) => newEdge(sp, id, advocate))).toBe('23514');
        expect(
          await stateOf(s, (sp) => newEdge(sp, id, advocate, { toPersonId: client, matterId })),
        ).toBe('23514');
        expect(
          await stateOf(s, (sp) => newEdge(sp, id, advocate, { matterId, proceedingId })),
        ).toBe('23514');
        expect(await stateOf(s, (sp) => newEdge(sp, id, advocate, { toPersonId: advocate }))).toBe(
          '23514',
        );

        await newEdge(s, id, advocate, { toPersonId: client });
        await newEdge(s, id, advocate, { kind: 'appears_for', matterId });
        await newEdge(s, id, advocate, { kind: 'assigned_to', proceedingId });
        expect(await s.select().from(roleEdge)).toHaveLength(3);
      });
    });
  });

  it('dies with its person, matter or proceeding', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const { matterId, proceedingId } = await newGraph(s, id);
        const advocate = await newPerson(s, id, { kind: 'advocate' });
        const party = await newPerson(s, id);
        const toParty = await newEdge(s, id, advocate, { toPersonId: party });
        const onProceeding = await newEdge(s, id, advocate, { proceedingId });
        const onMatter = await newEdge(s, id, party, { kind: 'opposes', matterId });

        await s.delete(person).where(eq(person.id, party));
        const left = await s.select({ id: roleEdge.id }).from(roleEdge);
        expect(left).toEqual([{ id: onProceeding }]);
        expect([toParty, onMatter]).not.toContain(left[0]?.id);

        await s.delete(proceeding).where(eq(proceeding.id, proceedingId));
        expect(await s.select().from(roleEdge)).toEqual([]);

        // A bare matter (no documents or proceedings holding it) takes its edges with it.
        const [bare] = await s
          .insert(matter)
          .values({ workspaceId: id, title: 'Applicant v. Board' })
          .returning({ id: matter.id });
        await newEdge(s, id, advocate, { matterId: bare?.id ?? '' });
        await newEdge(s, id, advocate, { matterId });
        await s.delete(matter).where(eq(matter.id, bare?.id ?? ''));
        const rest = await s.select({ matterId: roleEdge.matterId }).from(roleEdge);
        expect(rest).toEqual([{ matterId }]);
      });
    });
  });

  it('rejects a person, matter or proceeding of another workspace, even for the table owner', async () => {
    // The owner role is not exempt: the composite key, not RLS, rejects the other workspace's rows.
    const a = await owner.transaction((o) => newWorkspaceAsOwner(o));
    try {
      const b = await owner.transaction((o) => newWorkspaceAsOwner(o));
      try {
        const bRows = await owner.transaction(async (o) => {
          await o.execute(sql`select set_config('app.workspace_id', ${b.id}, true)`);
          return { ...(await newGraph(o, b.id)), personId: await newPerson(o, b.id) };
        });
        await owner.transaction(async (o) => {
          await o.execute(sql`select set_config('app.workspace_id', ${a.id}, true)`);
          const mine = await newPerson(o, a.id, { kind: 'advocate' });
          await newEdge(o, a.id, mine, { toPersonId: await newPerson(o, a.id) });
          for (const target of [
            { toPersonId: bRows.personId },
            { matterId: bRows.matterId },
            { proceedingId: bRows.proceedingId },
          ]) {
            expect(
              await stateOf(o, (sp) => newEdge(sp, a.id, mine, target)),
              JSON.stringify(target),
            ).toBe('23503');
          }
          expect(
            await stateOf(o, (sp) => newEdge(sp, a.id, bRows.personId, { toPersonId: mine })),
          ).toBe('23503');
          expect(
            await stateOf(o, (sp) =>
              newPerson(sp, a.id, { sourceType: 'document', anchorId: bRows.anchorId }),
            ),
          ).toBe('23503');
        });
      } finally {
        await dropWorkspaceAsOwner(b.id);
      }
    } finally {
      await dropWorkspaceAsOwner(a.id);
    }
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
    sql`insert into organization (id, name, slug) values (${id}, 'Chambers', ${`pp-${id}`})`,
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

describe('migration 0040', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterAll(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('applies on a database migrated through 0039', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'causedeck-0039-'));
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
    const journalPath = path.join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    const head = journal.entries.findIndex((e) => e.tag === '0039_proceedings');
    expect(head).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, head + 1);
    writeFileSync(journalPath, JSON.stringify(journal));

    const db = await createScratchDatabase(testDatabaseUrls(), 'people_0039');
    cleanups.push(db.drop);
    const before = await runMigrations({ url: new Secret(db.owner), migrationsFolder: dir });
    expect(before.latest).toBe('0039_proceedings');

    const scratch = createOwnerDb(new Secret(db.owner));
    cleanups.push(() => scratch.$client.end());
    // A matter and proceeding written before people existed stay and can take role edges afterwards.
    const ws = await scratch.transaction(async (o) => {
      const { id } = await newWorkspaceAsOwner(o);
      return { id, graph: await newGraph(o, id) };
    });

    const after = await runMigrations({ url: new Secret(db.owner) });
    expect(after.applied[0]).toBe('0040_people');
    await scratch.transaction(async (o) => {
      await o.execute(sql`select set_config('app.workspace_id', ${ws.id}, true)`);
      const advocate = await newPerson(o, ws.id, { kind: 'advocate' });
      await newEdge(o, ws.id, advocate, { proceedingId: ws.graph.proceedingId });
      expect(await stateOf(o, (sp) => newEdge(sp, ws.id, advocate))).toBe('23514');
    });
  }, 240_000);
});
