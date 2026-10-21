// Court-layer reference tables and the matter-graph foundations (#344, part 1 of #32): forum,
// court_hall and bench are global-or-workspace tables. Catalogue rows (null workspace_id) are written
// by the owner only and read by every workspace; custom rows stay inside their workspace; a hall or
// bench must have its forum's scope. Also: the member (workspace_id, id) key, the provenance enum,
// the grants, and migration 0037 applying on top of 0036.
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Secret } from '@causedeck/config/env';
import { eq, inArray, sql, TransactionRollbackError } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Transaction } from '../client.ts';
import { MIGRATIONS_FOLDER, runMigrations } from '../migrate.ts';
import { createOwnerDb } from '../owner.ts';
import { organization, user } from '../schema/auth.ts';
import { bench, courtHall, forum } from '../schema/court.ts';
import {
  createScratchDatabase,
  inWorkspace,
  testDatabaseUrls,
  withTestDb,
} from '../testing/index.ts';
import { seedTwoTenants } from '../testing/two-tenants.ts';
import { sqlState } from './rls/fixtures.ts';

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
const TAG = randomUUID().slice(0, 8);
const catalogue = { forumId: '', hallId: '', benchId: '', code: `test.catalogue.${TAG}` };

beforeAll(async () => {
  // Committed catalogue rows: the app-role transactions below must see them.
  const [f] = await owner
    .insert(forum)
    .values({ code: catalogue.code, court: 'Test High Court', jurisdictionKind: 'high_court' })
    .returning({ id: forum.id });
  if (f === undefined) throw new Error('catalogue forum insert failed');
  catalogue.forumId = f.id;
  const [h] = await owner
    .insert(courtHall)
    .values({ forumId: f.id, hallNo: '12A' })
    .returning({ id: courtHall.id });
  const [b] = await owner
    .insert(bench)
    .values({ forumId: f.id, judges: ['Judge X'], benchKind: 'division' })
    .returning({ id: bench.id });
  if (h === undefined || b === undefined) throw new Error('catalogue hall/bench insert failed');
  catalogue.hallId = h.id;
  catalogue.benchId = b.id;
});

afterAll(async () => {
  await owner.delete(courtHall).where(eq(courtHall.forumId, catalogue.forumId));
  await owner.delete(bench).where(eq(bench.forumId, catalogue.forumId));
  await owner.delete(forum).where(eq(forum.id, catalogue.forumId));
  await owner.$client.end();
});

/** Run `fn` as the owner in a transaction that is always rolled back. */
async function ownerRolledBack(fn: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await owner.transaction(async (tx) => {
      await fn(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

const insertForum = (tx: Transaction, workspaceId: string | null, code = `c.${randomUUID()}`) =>
  tx.transaction(async (sp) => {
    const [row] = await sp
      .insert(forum)
      .values({ workspaceId, code, court: 'Custom Forum', jurisdictionKind: 'other' })
      .returning({ id: forum.id });
    return row?.id ?? '';
  });

describe('global-or-workspace court reference tables (#344)', () => {
  it('every workspace reads the catalogue; custom rows stay inside their workspace', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua, ub } = await seedTwoTenants(tx);
      const aForum = a.rows.forum?.forumId ?? '';
      for (const [ws, uid] of [
        [a.id, ua],
        [b.id, ub],
      ] as const) {
        await inWorkspace(
          tx,
          ws,
          async (scoped) => {
            const forums = await scoped
              .select({ id: forum.id })
              .from(forum)
              .where(inArray(forum.id, [catalogue.forumId, aForum]));
            const expected = ws === a.id ? [catalogue.forumId, aForum] : [catalogue.forumId];
            expect(forums.map((r) => r.id).sort()).toEqual(expected.sort());
            const halls = await scoped
              .select({ id: courtHall.id })
              .from(courtHall)
              .where(eq(courtHall.id, catalogue.hallId));
            const benches = await scoped
              .select({ judges: bench.judges })
              .from(bench)
              .where(eq(bench.id, catalogue.benchId));
            expect(halls).toHaveLength(1);
            expect(benches).toEqual([{ judges: ['Judge X'] }]);
          },
          uid,
        );
      }
    });
  });

  it('the app role cannot insert, update or delete catalogue rows', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      await inWorkspace(
        tx,
        a.id,
        async (scoped) => {
          expect(await sqlState(insertForum(scoped, null))).toBe('42501');
          expect(
            await sqlState(
              scoped.transaction((sp) =>
                sp
                  .insert(courtHall)
                  .values({ workspaceId: null, forumId: catalogue.forumId, hallNo: '99' }),
              ),
            ),
          ).toBe('42501');
          const updated = await scoped
            .update(forum)
            .set({ court: 'Hijacked' })
            .where(eq(forum.id, catalogue.forumId))
            .returning({ id: forum.id });
          expect(updated).toEqual([]);
          const deleted = await scoped
            .delete(bench)
            .where(eq(bench.id, catalogue.benchId))
            .returning({ id: bench.id });
          expect(deleted).toEqual([]);
          // Moving a custom row into the catalogue fails too.
          const own = a.rows.forum?.forumId ?? '';
          expect(
            await sqlState(
              scoped.transaction((sp) =>
                sp.update(forum).set({ workspaceId: null }).where(eq(forum.id, own)),
              ),
            ),
          ).toBe('42501');
        },
        ua,
      );
      const [row] = await owner
        .select({ court: forum.court })
        .from(forum)
        .where(eq(forum.id, catalogue.forumId));
      expect(row?.court).toBe('Test High Court');
    });
  });

  it('a hall or bench must have its forum scope (scope guard)', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ub } = await seedTwoTenants(tx);
      const aForum = a.rows.forum?.forumId ?? '';
      await inWorkspace(
        tx,
        b.id,
        async (scoped) => {
          // B cannot hang a hall or bench on A's forum, even knowing its id.
          expect(
            await sqlState(
              scoped.transaction((sp) =>
                sp.insert(courtHall).values({ workspaceId: b.id, forumId: aForum, hallNo: '1' }),
              ),
            ),
          ).toBe('23503');
          expect(
            await sqlState(
              scoped.transaction((sp) =>
                sp
                  .insert(bench)
                  .values({ workspaceId: b.id, forumId: aForum, benchKind: 'single' }),
              ),
            ),
          ).toBe('23503');
          // Nor a workspace hall under a catalogue forum (mode `same`).
          expect(
            await sqlState(
              scoped.transaction((sp) =>
                sp
                  .insert(courtHall)
                  .values({ workspaceId: b.id, forumId: catalogue.forumId, hallNo: '1' }),
              ),
            ),
          ).toBe('23503');
          // Re-pointing B's own hall at A's forum is rejected as well.
          const own = b.rows.court_hall?.hallId ?? '';
          expect(
            await sqlState(
              scoped.transaction((sp) =>
                sp.update(courtHall).set({ forumId: aForum }).where(eq(courtHall.id, own)),
              ),
            ),
          ).toBe('23503');
        },
        ub,
      );
    });
  });

  it('the owner cannot put a catalogue hall under a workspace forum', async () => {
    await ownerRolledBack(async (tx) => {
      const workspaceId = randomUUID();
      const [u] = await tx
        .insert(user)
        .values({ name: 'Owner Test', email: `${randomUUID()}@example.test` })
        .returning({ id: user.id });
      await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
      await tx
        .insert(organization)
        .values({ id: workspaceId, name: 'Owner Test', slug: `ot-${TAG}`, createdBy: u?.id });
      const forumId = await insertForum(tx, workspaceId);
      await tx.execute(sql`select set_config('app.workspace_id', '', true)`);
      expect(
        await sqlState(
          tx.transaction((sp) => sp.insert(courtHall).values({ forumId, hallNo: '7' })),
        ),
      ).toBe('23503');
    });
  });

  it('forum.code is unique per scope and court_hall (forum_id, hall_no) is unique', async () => {
    await ownerRolledBack(async (tx) => {
      expect(await sqlState(insertForum(tx, null, catalogue.code))).toBe('23505');
      expect(
        await sqlState(
          tx.transaction((sp) =>
            sp.insert(courtHall).values({ forumId: catalogue.forumId, hallNo: '12A' }),
          ),
        ),
      ).toBe('23505');
      await tx.insert(courtHall).values({ forumId: catalogue.forumId, hallNo: '12B' });
    });
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      await inWorkspace(
        tx,
        a.id,
        async (scoped) => {
          // The catalogue code is free inside a workspace, once.
          expect(await insertForum(scoped, a.id, catalogue.code)).toMatch(/^[0-9a-f-]{36}$/);
          expect(await sqlState(insertForum(scoped, a.id, catalogue.code))).toBe('23505');
        },
        ua,
      );
    });
  });
});

describe('matter-graph foundations in the catalog (#344)', () => {
  it('has the member (workspace_id, id) key, the provenance enum and the grants', async () => {
    const [key] = await owner.execute<{ def: string }>(sql`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = 'member_workspace_id_id_uq'`);
    expect(key?.def).toBe('UNIQUE (workspace_id, id)');
    const [states] = await owner.execute<{ labels: string[] }>(
      sql`select enum_range(null::confirmation_state)::text[] as labels`,
    );
    expect(states?.labels).toEqual(['proposed', 'confirmed', 'auto_applied', 'corrected']);
    for (const table of ['forum', 'court_hall', 'bench']) {
      const [row] = await owner.execute<{ app: boolean; clerk: boolean }>(sql`
        select has_table_privilege('causedeck_app', ${table}, 'select, insert, update, delete') as app,
               has_table_privilege('causedeck_clerk', ${table}, 'select, insert, update, delete') as clerk`);
      expect(row, table).toEqual({ app: true, clerk: true });
    }
  });

  it('has no view that aggregates by judge (PX-9, ME-6)', async () => {
    const views = await owner.execute<{ name: string }>(sql`
      select viewname::text as name from pg_views
      where schemaname = 'public' and definition ilike '%judges%'`);
    expect(views).toEqual([]);
  });
});

describe('migration 0037', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterAll(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('applies on a database already migrated through 0036', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'causedeck-0036-'));
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
    const journalPath = path.join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    const head = journal.entries.findIndex((e) => e.tag === '0036_flag_change_request');
    expect(head).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, head + 1);
    writeFileSync(journalPath, JSON.stringify(journal));

    const db = await createScratchDatabase(testDatabaseUrls(), 'court_0036');
    cleanups.push(db.drop);
    const before = await runMigrations({ url: new Secret(db.owner), migrationsFolder: dir });
    expect(before.latest).toBe('0036_flag_change_request');
    const after = await runMigrations({ url: new Secret(db.owner) });
    expect(after.applied).toEqual(['0037_matter_graph_foundations']);
  }, 240_000);
});
