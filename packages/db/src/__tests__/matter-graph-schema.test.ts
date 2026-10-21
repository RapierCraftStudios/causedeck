// Matter and documents (#345, part 2 of #32): `matter`, `document`, `document_page` and `anchor` are
// tenant tables under FORCE RLS with composite (workspace_id, <parent>_id) FKs; the CHECKs of the #32
// data contract; the ON DELETE actions an account deletion and the batched erase rely on; the
// `matter_restriction` FK to `matter`; and migration 0038 applying on top of 0037 with an orphan
// restriction row.
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
import { member } from '../schema/auth.ts';
import { anchor, document, documentPage } from '../schema/documents.ts';
import { matter } from '../schema/matter-graph.ts';
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

const TABLES = ['matter', 'document', 'document_page', 'anchor'] as const;

async function newMatter(
  s: Transaction,
  workspaceId: string,
  values: Partial<typeof matter.$inferInsert> = {},
): Promise<string> {
  const [row] = await s
    .insert(matter)
    .values({ workspaceId, title: 'Test v. State', ...values })
    .returning({ id: matter.id });
  if (row === undefined) throw new Error('matter insert returned no row');
  return row.id;
}

async function newDocument(
  s: Transaction,
  workspaceId: string,
  values: Partial<typeof document.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID();
  const [row] = await s
    .insert(document)
    .values({
      id,
      workspaceId,
      kind: 'order',
      storageKey: `ws/${workspaceId}/document/${id}`,
      sha256: 'a'.repeat(64),
      ...values,
    })
    .returning({ id: document.id });
  if (row === undefined) throw new Error('document insert returned no row');
  return row.id;
}

/** The SQLSTATE of `fn` run in a savepoint (null when it succeeds). */
const stateOf = (s: Transaction, fn: (sp: Transaction) => Promise<unknown>) =>
  sqlState(s.transaction(fn));

describe('matter graph tables in the catalog (#345)', () => {
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
        policies: ['ws_isolation'],
        app: true,
        clerk: true,
      });
    }
  });

  it('has composite tenant FKs with the column-list SET NULL actions', async () => {
    const rows = await owner.execute<{ name: string; def: string }>(sql`
      select conname::text as name, pg_get_constraintdef(oid) as def from pg_constraint
      where contype = 'f' and conname in (
        'matter_owner_member_fk', 'matter_merged_into_fk', 'document_matter_fk',
        'document_supersedes_fk', 'document_page_document_fk', 'anchor_document_fk',
        'matter_restriction_matter_fk')
      order by 1`);
    expect(Object.fromEntries(rows.map((r) => [r.name, r.def]))).toEqual({
      anchor_document_fk:
        'FOREIGN KEY (workspace_id, document_id) REFERENCES document(workspace_id, id) ON DELETE CASCADE',
      document_matter_fk:
        'FOREIGN KEY (workspace_id, matter_id) REFERENCES matter(workspace_id, id)',
      document_page_document_fk:
        'FOREIGN KEY (workspace_id, document_id) REFERENCES document(workspace_id, id) ON DELETE CASCADE',
      document_supersedes_fk:
        'FOREIGN KEY (workspace_id, supersedes_document_id) REFERENCES document(workspace_id, id) ON DELETE SET NULL (supersedes_document_id)',
      matter_merged_into_fk:
        'FOREIGN KEY (workspace_id, merged_into_matter_id) REFERENCES matter(workspace_id, id) ON DELETE SET NULL (merged_into_matter_id)',
      matter_owner_member_fk:
        'FOREIGN KEY (workspace_id, owner_member_id) REFERENCES member(workspace_id, id) ON DELETE SET NULL (owner_member_id)',
      matter_restriction_matter_fk:
        'FOREIGN KEY (workspace_id, matter_id) REFERENCES matter(workspace_id, id) ON DELETE CASCADE',
    });
  });
});

describe('matter (#345)', () => {
  it('defaults to active and not sensitive; status is active, disposed or archived', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const matterId = await newMatter(s, id);
        const [row] = await s.select().from(matter).where(eq(matter.id, matterId));
        expect(row).toMatchObject({ status: 'active', sensitive: false, ownerMemberId: null });
        for (const status of ['disposed', 'archived'] as const) {
          await s.update(matter).set({ status }).where(eq(matter.id, matterId));
        }
        expect(
          await stateOf(s, (sp) =>
            sp.execute(sql`update matter set status = 'closed' where id = ${matterId}`),
          ),
        ).toBe('23514');
      });
    });
  });

  it('owner_member_id must be a member of the same workspace, even for the table owner', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const memberOf = async (workspaceId: string) =>
        inWorkspace(tx, workspaceId, async (s) => {
          const [m] = await s
            .select({ id: member.id })
            .from(member)
            .where(eq(member.organizationId, workspaceId));
          return m?.id ?? '';
        });
      const aMember = await memberOf(a.id);
      const bMember = await memberOf(b.id);
      await inWorkspace(tx, a.id, async (s) => {
        await newMatter(s, a.id, { ownerMemberId: aMember });
        expect(await stateOf(s, (sp) => newMatter(sp, a.id, { ownerMemberId: bMember }))).toBe(
          '23503',
        );
      });
    });
    // The owner role is not exempt: the composite key, not RLS, rejects the other workspace's member.
    const a = await owner.transaction((o) => newWorkspaceAsOwner(o));
    try {
      const b = await owner.transaction((o) => newWorkspaceAsOwner(o));
      await owner.transaction(async (o) => {
        await o.execute(sql`select set_config('app.workspace_id', ${a.id}, true)`);
        expect(await stateOf(o, (sp) => newMatter(sp, a.id, { ownerMemberId: b.memberId }))).toBe(
          '23503',
        );
      });
      await dropWorkspaceAsOwner(b.id);
    } finally {
      await dropWorkspaceAsOwner(a.id);
    }
  });

  it('survives its owner losing their membership, and a merge target being deleted', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx, 2);
      await inWorkspace(tx, ws.id, async (s) => {
        const [m] = await s
          .select({ id: member.id })
          .from(member)
          .where(eq(member.userId, ws.userIds[1] ?? ''));
        const target = await newMatter(s, ws.id);
        const merged = await newMatter(s, ws.id, {
          ownerMemberId: m?.id ?? '',
          mergedIntoMatterId: target,
        });
        expect(
          await stateOf(s, (sp) =>
            sp.update(matter).set({ mergedIntoMatterId: merged }).where(eq(matter.id, merged)),
          ),
        ).toBe('23514');

        await s.delete(member).where(eq(member.id, m?.id ?? ''));
        await s.delete(matter).where(eq(matter.id, target));
        const [row] = await s.select().from(matter).where(eq(matter.id, merged));
        expect(row).toMatchObject({
          workspaceId: ws.id,
          ownerMemberId: null,
          mergedIntoMatterId: null,
        });
      });
    });
  });
});

describe('document, document_page and anchor (#345)', () => {
  it('a document belongs to a matter of its workspace; a matter with documents stays', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const bMatter = await inWorkspace(tx, b.id, (s) => newMatter(s, b.id));
      await inWorkspace(tx, a.id, async (s) => {
        expect(await stateOf(s, (sp) => newDocument(sp, a.id, { matterId: bMatter }))).toBe(
          '23503',
        );
        const matterId = await newMatter(s, a.id);
        await newDocument(s, a.id, { matterId });
        expect(await stateOf(s, (sp) => sp.delete(matter).where(eq(matter.id, matterId)))).toBe(
          '23503',
        );
        // A document without a matter is fine (filed before the matter exists).
        await newDocument(s, a.id);
        expect(await stateOf(s, (sp) => newDocument(sp, a.id, { sha256: 'not-a-hash' }))).toBe(
          '23514',
        );
      });
    });
  });

  it('a version chain survives deleting an earlier version; pages and anchors go with their document', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const v1 = await newDocument(s, id);
        const v2 = await newDocument(s, id, { supersedesDocumentId: v1 });
        await s.insert(documentPage).values({ workspaceId: id, documentId: v1, pageNo: 1 });
        expect(
          await stateOf(s, (sp) =>
            sp.insert(documentPage).values({ workspaceId: id, documentId: v1, pageNo: 1 }),
          ),
        ).toBe('23505');
        expect(
          await stateOf(s, (sp) =>
            sp.insert(documentPage).values({ workspaceId: id, documentId: v1, pageNo: 0 }),
          ),
        ).toBe('23514');
        await s
          .insert(anchor)
          .values({ workspaceId: id, documentId: v1, pageNo: 1, quote: 'q', kind: 'document' });

        await s.delete(document).where(eq(document.id, v1));
        const [row] = await s.select().from(document).where(eq(document.id, v2));
        expect(row).toMatchObject({ workspaceId: id, supersedesDocumentId: null });
        expect(await s.select().from(documentPage).where(eq(documentPage.documentId, v1))).toEqual(
          [],
        );
        expect(await s.select().from(anchor).where(eq(anchor.documentId, v1))).toEqual([]);
      });
    });
  });

  it('an anchor quote is capped at 2,000 characters; kind and character range are checked', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const bDoc = await inWorkspace(tx, b.id, (s) => newDocument(s, b.id));
      await inWorkspace(tx, a.id, async (s) => {
        const documentId = await newDocument(s, a.id);
        const base = { workspaceId: a.id, documentId, pageNo: 2, kind: 'transcript' as const };
        const [row] = await s
          .insert(anchor)
          .values({
            ...base,
            quote: 'x'.repeat(2000),
            charStart: 10,
            charEnd: 2010,
            bbox: { x: 1, y: 2, width: 3, height: 4 },
            transcriptSpan: { startMs: 0, endMs: 1500 },
          })
          .returning();
        expect(row).toMatchObject({ bbox: { x: 1, y: 2, width: 3, height: 4 } });
        const insert = (values: Partial<typeof anchor.$inferInsert>) =>
          stateOf(s, (sp) => sp.insert(anchor).values({ ...base, quote: 'q', ...values }));
        expect(await insert({ quote: 'x'.repeat(2001) })).toBe('23514');
        expect(await insert({ charStart: 20, charEnd: 10 })).toBe('23514');
        expect(
          await stateOf(s, (sp) =>
            sp.execute(
              sql`insert into anchor (workspace_id, document_id, page_no, quote, kind) values (${a.id}, ${documentId}, 1, 'q', 'video')`,
            ),
          ),
        ).toBe('23514');
        expect(await insert({ documentId: bDoc })).toBe('23503');
      });
    });
  });
});

/** A committed workspace with one owner member, written as the owner role (FORCE RLS binds it). */
async function newWorkspaceAsOwner(o: Transaction): Promise<{ id: string; memberId: string }> {
  const id = randomUUID();
  await o.execute(sql`select set_config('app.workspace_id', ${id}, true)`);
  const [u] = await o.execute<{ id: string }>(
    sql`insert into "user" (name, email) values ('Owner', ${`${id}@example.test`}) returning id`,
  );
  await o.execute(
    sql`insert into organization (id, name, slug) values (${id}, 'Chambers', ${`mg-${id}`})`,
  );
  const [m] = await o.execute<{ id: string }>(
    sql`insert into member (workspace_id, user_id, role) values (${id}, ${u?.id ?? ''}, 'owner') returning id`,
  );
  return { id, memberId: m?.id ?? '' };
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

describe('migration 0038', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterAll(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('applies on a database migrated through 0037 and drops its orphan restriction rows', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'causedeck-0037-'));
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
    const journalPath = path.join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    const head = journal.entries.findIndex((e) => e.tag === '0037_matter_graph_foundations');
    expect(head).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, head + 1);
    writeFileSync(journalPath, JSON.stringify(journal));

    const db = await createScratchDatabase(testDatabaseUrls(), 'matter_0037');
    cleanups.push(db.drop);
    const before = await runMigrations({ url: new Secret(db.owner), migrationsFolder: dir });
    expect(before.latest).toBe('0037_matter_graph_foundations');

    const scratch = createOwnerDb(new Secret(db.owner));
    cleanups.push(() => scratch.$client.end());
    // A restriction written before matter existed: its matter id names nothing.
    const workspaceId = await scratch.transaction(async (o) => {
      const ws = await newWorkspaceAsOwner(o);
      await o.execute(
        sql`insert into matter_restriction (workspace_id, matter_id) values (${ws.id}, ${randomUUID()})`,
      );
      return ws.id;
    });

    const after = await runMigrations({ url: new Secret(db.owner) });
    expect(after.applied[0]).toBe('0038_matter_documents');
    const [rls] = await scratch.execute<{ forced: boolean }>(
      sql`select relforcerowsecurity as forced from pg_class where relname = 'matter_restriction'`,
    );
    expect(rls?.forced).toBe(true);
    await scratch.transaction(async (o) => {
      await o.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
      const [row] = await o.execute<{ n: number }>(
        sql`select count(*)::int as n from matter_restriction`,
      );
      expect(row?.n).toBe(0);
    });
  }, 240_000);
});
