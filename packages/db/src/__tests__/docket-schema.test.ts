// The docket (#347, part 4 of #32): `listing`, `hearing`, `appearance`, `order`, `obligation` and
// `task` are tenant tables under FORCE RLS with composite (workspace_id, <parent>_id) FKs (member
// references included) and provenance; one canonical listing per proceeding; the obligation closure
// invariant (CHECK plus the closed_by guard, which still lets the closer's account go); hall and
// bench references scope-guarded to a catalogue or own row; and migration 0041 applying on 0040.
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
import { member } from '../schema/auth.ts';
import { bench, courtHall, forum } from '../schema/court.ts';
import { appearance, hearing, listing, obligation, order, task } from '../schema/docket.ts';
import { anchor } from '../schema/documents.ts';
import { matter } from '../schema/matter-graph.ts';
import { proceeding } from '../schema/proceedings.ts';
import {
  createScratchDatabase,
  inWorkspace,
  testDatabaseUrls,
  withTestDb,
} from '../testing/index.ts';
import { newWorkspace, sqlState } from './rls/fixtures.ts';

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
const TAG = randomUUID().slice(0, 8);
const catalogue = { forumId: '', hallId: '', benchId: '' };

beforeAll(async () => {
  // A committed catalogue forum, hall and bench (null workspace_id): only the owner may write them.
  await owner.transaction(async (o) => {
    const [f] = await o
      .insert(forum)
      .values({
        code: `test.docket.${TAG}`,
        court: 'Test High Court',
        jurisdictionKind: 'high_court',
      })
      .returning({ id: forum.id });
    if (f === undefined) throw new Error('catalogue forum insert failed');
    const [h] = await o
      .insert(courtHall)
      .values({ forumId: f.id, hallNo: '3', label: 'Court Hall 3' })
      .returning({ id: courtHall.id });
    const [b] = await o
      .insert(bench)
      .values({ forumId: f.id, judges: ['Judge A'], benchKind: 'single' })
      .returning({ id: bench.id });
    if (h === undefined || b === undefined) throw new Error('catalogue hall/bench insert failed');
    Object.assign(catalogue, { forumId: f.id, hallId: h.id, benchId: b.id });
  });
});

afterAll(async () => {
  await owner.transaction(async (o) => {
    await o.delete(courtHall).where(eq(courtHall.id, catalogue.hallId));
    await o.delete(bench).where(eq(bench.id, catalogue.benchId));
    await o.delete(forum).where(eq(forum.id, catalogue.forumId));
  });
  await owner.$client.end();
});

const TABLES = ['listing', 'hearing', 'appearance', 'order', 'obligation', 'task'] as const;

/** The SQLSTATE of `fn` run in a savepoint (null when it succeeds). */
const stateOf = (s: Transaction, fn: (sp: Transaction) => Promise<unknown>) =>
  sqlState(s.transaction(fn));

const one = <T>(rows: T[], what: string): T => {
  const [row] = rows;
  if (row === undefined) throw new Error(`${what} insert returned no row`);
  return row;
};

interface Graph {
  workspaceId: string;
  matterId: string;
  forumId: string;
  hallId: string;
  benchId: string;
  proceedingId: string;
  documentId: string;
  anchorId: string;
  memberIds: string[];
}

/** A matter, custom forum with hall and bench, proceeding, document and anchor of the workspace. */
async function newGraph(s: Transaction, workspaceId: string): Promise<Graph> {
  const { id: matterId } = one(
    await s
      .insert(matter)
      .values({ workspaceId, title: 'Petitioner v. State' })
      .returning({ id: matter.id }),
    'matter',
  );
  const { id: forumId } = one(
    await s
      .insert(forum)
      .values({
        workspaceId,
        code: `custom.${randomUUID().slice(0, 8)}`,
        court: 'Custom District Court',
        jurisdictionKind: 'district',
      })
      .returning({ id: forum.id }),
    'forum',
  );
  const { id: hallId } = one(
    await s
      .insert(courtHall)
      .values({ workspaceId, forumId, hallNo: '12A', label: 'Court Hall 12A' })
      .returning({ id: courtHall.id }),
    'court_hall',
  );
  const { id: benchId } = one(
    await s
      .insert(bench)
      .values({ workspaceId, forumId, judges: ['Judge B'], benchKind: 'single' })
      .returning({ id: bench.id }),
    'bench',
  );
  const { id: proceedingId } = one(
    await s
      .insert(proceeding)
      .values({ workspaceId, matterId, forumId, caseTypeCode: 'WP', sourceType: 'manual' })
      .returning({ id: proceeding.id }),
    'proceeding',
  );
  // Explicit columns: the 0041 test runs this on a database migrated only through 0040, and a
  // Drizzle insert would list document columns added by later migrations (0058 and on).
  const storageKey = `ws/${workspaceId}/document/${randomUUID()}`;
  const [inserted] = (await s.execute(
    sql`insert into document (workspace_id, matter_id, kind, storage_key, sha256) values (${workspaceId}, ${matterId}, 'order', ${storageKey}, ${'c'.repeat(64)}) returning id`,
  )) as unknown as { id: string }[];
  const { id: documentId } = one(inserted === undefined ? [] : [inserted], 'document');
  const { id: anchorId } = one(
    await s
      .insert(anchor)
      .values({ workspaceId, documentId, pageNo: 1, quote: 'list on 2.11.2026', kind: 'document' })
      .returning({ id: anchor.id }),
    'anchor',
  );
  const members = await s
    .select({ id: member.id })
    .from(member)
    .where(eq(member.organizationId, workspaceId))
    .orderBy(member.id);
  return {
    workspaceId,
    matterId,
    forumId,
    hallId,
    benchId,
    proceedingId,
    documentId,
    anchorId,
    memberIds: members.map((m) => m.id),
  };
}

const newListing = async (
  s: Transaction,
  g: Graph,
  values: Partial<typeof listing.$inferInsert> = {},
) =>
  one(
    await s
      .insert(listing)
      .values({
        workspaceId: g.workspaceId,
        proceedingId: g.proceedingId,
        listDate: '2026-11-02',
        listType: 'daily',
        stageRaw: 'FOR ADMISSION',
        sourceType: 'manual',
        ...values,
      })
      .returning({ id: listing.id }),
    'listing',
  ).id;

const newHearing = async (
  s: Transaction,
  g: Graph,
  listingId: string,
  values: Partial<typeof hearing.$inferInsert> = {},
) =>
  one(
    await s
      .insert(hearing)
      .values({
        workspaceId: g.workspaceId,
        listingId,
        heldOn: '2026-11-02',
        sourceType: 'manual',
        ...values,
      })
      .returning({ id: hearing.id }),
    'hearing',
  ).id;

const newOrder = async (
  s: Transaction,
  g: Graph,
  values: Partial<typeof order.$inferInsert> = {},
) =>
  one(
    await s
      .insert(order)
      .values({
        workspaceId: g.workspaceId,
        proceedingId: g.proceedingId,
        documentId: g.documentId,
        orderDate: '2026-11-02',
        orderType: 'interim',
        sourceType: 'manual',
        ...values,
      })
      .returning({ id: order.id }),
    'order',
  ).id;

const newObligation = async (
  s: Transaction,
  g: Graph,
  values: Partial<typeof obligation.$inferInsert> = {},
) =>
  one(
    await s
      .insert(obligation)
      .values({
        workspaceId: g.workspaceId,
        matterId: g.matterId,
        source: 'order_direction',
        description: 'File the counter affidavit',
        sourceType: 'manual',
        ...values,
      })
      .returning({ id: obligation.id }),
    'obligation',
  ).id;

const newTask = async (s: Transaction, g: Graph, values: Partial<typeof task.$inferInsert> = {}) =>
  one(
    await s
      .insert(task)
      .values({ workspaceId: g.workspaceId, title: 'Draft it', sourceType: 'manual', ...values })
      .returning({ id: task.id }),
    'task',
  ).id;

describe('docket tables in the catalog (#347)', () => {
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
        // listing also carries the owner-only definer read that app_board_poll_targets (0074, #493) needs.
        policies: table === 'listing' ? ['owner_definer_read', 'ws_isolation'] : ['ws_isolation'],
        app: true,
        clerk: true,
      });
    }
  });

  it('has composite tenant FKs (member references included), scope-guarded hall and bench FKs and the closed_by guard', async () => {
    const rows = await owner.execute<{ name: string; def: string }>(sql`
      select conname::text as name, pg_get_constraintdef(oid) as def from pg_constraint
      where contype = 'f' and conrelid in ('listing'::regclass, 'hearing'::regclass,
              'appearance'::regclass, '"order"'::regclass, 'obligation'::regclass, 'task'::regclass)
        and conname not like '%workspace_id_fk'
      order by 1`);
    const anchorFk = 'FOREIGN KEY (workspace_id, anchor_id) REFERENCES anchor(workspace_id, id)';
    expect(Object.fromEntries(rows.map((r) => [r.name, r.def]))).toEqual({
      appearance_assigned_by_fk:
        'FOREIGN KEY (workspace_id, assigned_by_member_id) REFERENCES member(workspace_id, id) ON DELETE SET NULL (assigned_by_member_id)',
      appearance_hearing_fk:
        'FOREIGN KEY (workspace_id, hearing_id) REFERENCES hearing(workspace_id, id) ON DELETE CASCADE',
      appearance_member_fk:
        'FOREIGN KEY (workspace_id, member_id) REFERENCES member(workspace_id, id) ON DELETE SET NULL (member_id)',
      hearing_anchor_fk: anchorFk,
      hearing_listing_fk:
        'FOREIGN KEY (workspace_id, listing_id) REFERENCES listing(workspace_id, id)',
      listing_anchor_fk: anchorFk,
      listing_bench_id_bench_id_fk:
        'FOREIGN KEY (bench_id) REFERENCES bench(id) ON DELETE RESTRICT',
      listing_hall_id_court_hall_id_fk:
        'FOREIGN KEY (hall_id) REFERENCES court_hall(id) ON DELETE RESTRICT',
      listing_proceeding_fk:
        'FOREIGN KEY (workspace_id, proceeding_id) REFERENCES proceeding(workspace_id, id)',
      listing_source_document_fk:
        'FOREIGN KEY (workspace_id, source_document_id) REFERENCES document(workspace_id, id) ON DELETE SET NULL (source_document_id)',
      obligation_anchor_fk: anchorFk,
      obligation_closed_by_fk:
        'FOREIGN KEY (workspace_id, closed_by) REFERENCES member(workspace_id, id) ON DELETE SET NULL (closed_by)',
      obligation_matter_fk:
        'FOREIGN KEY (workspace_id, matter_id) REFERENCES matter(workspace_id, id)',
      obligation_owner_member_fk:
        'FOREIGN KEY (workspace_id, owner_member_id) REFERENCES member(workspace_id, id) ON DELETE SET NULL (owner_member_id)',
      obligation_proceeding_fk:
        'FOREIGN KEY (workspace_id, proceeding_id) REFERENCES proceeding(workspace_id, id)',
      obligation_source_order_fk:
        'FOREIGN KEY (workspace_id, source_order_id) REFERENCES "order"(workspace_id, id) ON DELETE SET NULL (source_order_id)',
      order_anchor_fk: anchorFk,
      order_bench_id_bench_id_fk: 'FOREIGN KEY (bench_id) REFERENCES bench(id) ON DELETE RESTRICT',
      order_document_fk:
        'FOREIGN KEY (workspace_id, document_id) REFERENCES document(workspace_id, id)',
      order_proceeding_fk:
        'FOREIGN KEY (workspace_id, proceeding_id) REFERENCES proceeding(workspace_id, id)',
      task_anchor_fk: anchorFk,
      task_fulfils_obligation_fk:
        'FOREIGN KEY (workspace_id, fulfils_obligation_id) REFERENCES obligation(workspace_id, id) ON DELETE SET NULL (fulfils_obligation_id)',
      task_matter_fk: 'FOREIGN KEY (workspace_id, matter_id) REFERENCES matter(workspace_id, id)',
      task_owner_member_fk:
        'FOREIGN KEY (workspace_id, owner_member_id) REFERENCES member(workspace_id, id) ON DELETE SET NULL (owner_member_id)',
      task_proceeding_fk:
        'FOREIGN KEY (workspace_id, proceeding_id) REFERENCES proceeding(workspace_id, id)',
    });
    const triggers = await owner.execute<{ name: string }>(sql`
      select tgname::text as name from pg_trigger
      where tgrelid in ('listing'::regclass, '"order"'::regclass, 'obligation'::regclass)
        and not tgisinternal
      order by 1`);
    expect(triggers.map((t) => t.name)).toEqual([
      'listing_bench_id_scope_guard',
      'listing_hall_id_scope_guard',
      'obligation_closed_by_guard',
      'order_bench_id_scope_guard',
    ]);
  });
});

describe('listing (#347)', () => {
  it('allows exactly one canonical listing per proceeding, and a flip inside one transaction', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const g = await newGraph(s, id);
        const first = await newListing(s, g, { canonical: true });
        expect(
          await stateOf(s, (sp) => newListing(sp, g, { listDate: '2026-11-09', canonical: true })),
        ).toBe('23505');
        // Non-canonical listings of the same proceeding are fine.
        const second = await newListing(s, g, { listDate: '2026-11-09' });
        await newListing(s, g, { listDate: '2026-11-16', listType: 'advance' });
        // Another proceeding has its own canonical listing.
        const other = one(
          await s
            .insert(proceeding)
            .values({
              workspaceId: id,
              matterId: g.matterId,
              forumId: g.forumId,
              caseTypeCode: 'WMP',
              sourceType: 'manual',
            })
            .returning({ id: proceeding.id }),
          'proceeding',
        ).id;
        await newListing(s, { ...g, proceedingId: other }, { canonical: true });
        // Setting the new one first fails; unset old then set new inside one transaction succeeds.
        expect(
          await stateOf(s, (sp) =>
            sp.update(listing).set({ canonical: true }).where(eq(listing.id, second)),
          ),
        ).toBe('23505');
        await s.transaction(async (sp) => {
          await sp.update(listing).set({ canonical: false }).where(eq(listing.id, first));
          await sp.update(listing).set({ canonical: true }).where(eq(listing.id, second));
        });
        const canonical = await s
          .select({ id: listing.id })
          .from(listing)
          .where(sql`canonical and proceeding_id = ${g.proceedingId}`);
        expect(canonical).toEqual([{ id: second }]);
      });
    });
  });

  it('has the (workspace_id, proceeding_id, list_date) and (workspace_id, list_date, hall_id) indexes', async () => {
    const rows = await owner.execute<{ def: string }>(sql`
      select indexdef as def from pg_indexes
       where schemaname = 'public' and tablename = 'listing'
         and indexname in ('listing_workspace_proceeding_date_idx', 'listing_workspace_date_hall_idx',
                           'listing_one_canonical_uq')
       order by indexname`);
    expect(rows.map((r) => r.def.replace(/^.* USING /, ''))).toEqual([
      'btree (workspace_id, proceeding_id) WHERE canonical',
      'btree (workspace_id, list_date, hall_id)',
      'btree (workspace_id, proceeding_id, list_date)',
    ]);
  });

  it('references a catalogue or own hall and bench, never another workspace one', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const bg = await inWorkspace(tx, b.id, (s) => newGraph(s, b.id));
      await inWorkspace(tx, a.id, async (s) => {
        const g = await newGraph(s, a.id);
        await newListing(s, g, { hallId: g.hallId, benchId: g.benchId });
        const lid = await newListing(s, g, {
          hallId: catalogue.hallId,
          benchId: catalogue.benchId,
        });
        await newOrder(s, g, { benchId: g.benchId });
        const oid = await newOrder(s, g, { benchId: catalogue.benchId });
        expect(await stateOf(s, (sp) => newListing(sp, g, { hallId: bg.hallId }))).toBe('23503');
        expect(await stateOf(s, (sp) => newListing(sp, g, { benchId: bg.benchId }))).toBe('23503');
        expect(await stateOf(s, (sp) => newOrder(sp, g, { benchId: bg.benchId }))).toBe('23503');
        expect(
          await stateOf(s, (sp) =>
            sp.update(listing).set({ hallId: bg.hallId }).where(eq(listing.id, lid)),
          ),
        ).toBe('23503');
        expect(
          await stateOf(s, (sp) =>
            sp.update(order).set({ benchId: bg.benchId }).where(eq(order.id, oid)),
          ),
        ).toBe('23503');
      });
    });
  });
});

describe('obligation closure (#347)', () => {
  it('needs a reason type, closed_by and closed_at to close, and a note for not_applicable', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const g = await newGraph(s, id);
        const closer = g.memberIds[0] ?? '';
        const closedAt = new Date('2026-11-03T10:00:00Z');
        const oid = await newObligation(s, g, { ownerMemberId: closer, dueDate: '2026-11-10' });

        // A direct status flip without the closure fields is rejected.
        expect(
          await stateOf(s, (sp) =>
            sp.execute(sql`update obligation set status = 'done' where id = ${oid}`),
          ),
        ).toBe('23514');
        const close = (set: Partial<typeof obligation.$inferInsert>) =>
          stateOf(s, (sp) => sp.update(obligation).set(set).where(eq(obligation.id, oid)));
        for (const status of ['done', 'not_applicable', 'superseded'] as const) {
          // Each closure field missing in turn.
          expect(await close({ status, closedBy: closer, closedAt }), `${status} reason`).toBe(
            '23514',
          );
          expect(
            await close({ status, closedReasonType: 'lawyer_action', closedAt }),
            `${status} closed_by`,
          ).toBe('23514');
          expect(
            await close({ status, closedReasonType: 'lawyer_action', closedBy: closer }),
            `${status} closed_at`,
          ).toBe('23514');
        }
        expect(
          await stateOf(s, (sp) =>
            sp.execute(
              sql`update obligation set status = 'done', closed_reason_type = 'forgot', closed_by = ${closer}, closed_at = now() where id = ${oid}`,
            ),
          ),
        ).toBe('23514');
        // not_applicable needs a non-blank note.
        const na = {
          status: 'not_applicable',
          closedReasonType: 'not_applicable',
          closedBy: closer,
          closedAt,
        } as const;
        expect(await close(na)).toBe('23514');
        expect(await close({ ...na, closedNote: '   ' })).toBe('23514');
        expect(await close({ ...na, closedNote: 'Order recalled' })).toBeUndefined();
        // A closed row cannot drop its closure fields, or have closed_by cleared directly.
        expect(await close({ closedAt: null })).toBe('23514');
        expect(await close({ closedBy: null })).toBe('23514');
        // Reopening is fine; so is inserting an already-closed obligation with every field.
        expect(await close({ status: 'open' })).toBeUndefined();
        expect(
          await stateOf(s, (sp) =>
            newObligation(sp, g, {
              status: 'done',
              closedReasonType: 'task_completed',
              closedBy: closer,
              closedAt,
            }),
          ),
        ).toBeUndefined();
        expect(
          await stateOf(s, (sp) =>
            newObligation(sp, g, {
              status: 'superseded',
              closedReasonType: 'lawyer_action',
              closedAt,
            }),
          ),
        ).toBe('23514');
      });
    });
  });

  it('keeps a closed obligation when the closer leaves: closed_by and the member columns go null', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx, 2);
      await inWorkspace(tx, id, async (s) => {
        const g = await newGraph(s, id);
        const [leaver, stayer] = g.memberIds;
        if (leaver === undefined || stayer === undefined) throw new Error('two members expected');
        const oid = await newObligation(s, g, {
          ownerMemberId: leaver,
          status: 'done',
          closedReasonType: 'lawyer_action',
          closedBy: leaver,
          closedAt: new Date(),
        });
        const tid = await newTask(s, g, { ownerMemberId: leaver, fulfilsObligationId: oid });
        const lid = await newListing(s, g);
        const hid = await newHearing(s, g, lid);
        await s.insert(appearance).values({
          workspaceId: id,
          hearingId: hid,
          memberId: leaver,
          capacity: 'arguing',
        });

        await s.delete(member).where(eq(member.id, leaver));

        const [o] = await s.select().from(obligation).where(eq(obligation.id, oid));
        expect(o).toMatchObject({
          workspaceId: id,
          status: 'done',
          closedBy: null,
          ownerMemberId: null,
        });
        const [t] = await s.select().from(task).where(eq(task.id, tid));
        expect(t).toMatchObject({ workspaceId: id, ownerMemberId: null, fulfilsObligationId: oid });
        const [ap] = await s.select().from(appearance).where(eq(appearance.hearingId, hid));
        expect(ap).toMatchObject({ workspaceId: id, memberId: null });
      });
    });
  });
});

describe('account deletion and the docket (#347)', () => {
  it('deletes a user who closed an obligation: the member row cascades and closed_by goes null', async () => {
    const ws = await owner.transaction((o) => newWorkspaceAsOwner(o));
    try {
      const { oid, userId } = await owner.transaction(async (o) => {
        await o.execute(sql`select set_config('app.workspace_id', ${ws.id}, true)`);
        const g = await newGraph(o, ws.id);
        const [u] = await o.execute<{ id: string }>(
          sql`insert into "user" (name, email) values ('Junior', ${`${randomUUID()}@example.test`}) returning id`,
        );
        const [m] = await o.execute<{ id: string }>(
          sql`insert into member (workspace_id, user_id, role) values (${ws.id}, ${u?.id ?? ''}, 'advocate') returning id`,
        );
        const id = await newObligation(o, g, {
          ownerMemberId: m?.id ?? '',
          status: 'done',
          closedReasonType: 'task_completed',
          closedBy: m?.id ?? '',
          closedAt: new Date(),
        });
        return { oid: id, userId: u?.id ?? '' };
      });
      // As account deletion does (account.ts): the user row goes, its memberships cascade.
      await owner.execute(sql`delete from "user" where id = ${userId}`);
      await owner.transaction(async (o) => {
        await o.execute(sql`select set_config('app.workspace_id', ${ws.id}, true)`);
        const [row] = await o.select().from(obligation).where(eq(obligation.id, oid));
        expect(row).toMatchObject({ status: 'done', closedBy: null, ownerMemberId: null });
      });
    } finally {
      await dropWorkspaceAsOwner(ws.id);
    }
  });
});

describe('provenance on listing, hearing, order, obligation and task (#347)', () => {
  it('rejects a non-manual row with neither anchor_id nor source_ref', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const g = await newGraph(s, id);
        const lid = await newListing(s, g);
        const inserts = {
          listing: (sp: Transaction, v: object) => newListing(sp, g, v),
          hearing: (sp: Transaction, v: object) => newHearing(sp, g, lid, v),
          order: (sp: Transaction, v: object) => newOrder(sp, g, v),
          obligation: (sp: Transaction, v: object) => newObligation(sp, g, v),
          task: (sp: Transaction, v: object) => newTask(sp, g, v),
        };
        for (const [table, insert] of Object.entries(inserts)) {
          expect(await stateOf(s, (sp) => insert(sp, { sourceType: 'ai' })), table).toBe('23514');
          expect(
            await stateOf(s, (sp) =>
              insert(sp, { sourceType: 'ai', anchorId: g.anchorId, confidence: '1.500' }),
            ),
            table,
          ).toBe('23514');
          expect(
            await stateOf(s, (sp) =>
              insert(sp, { sourceType: 'ai', anchorId: g.anchorId, confidence: '0.900' }),
            ),
            table,
          ).toBeUndefined();
          expect(
            await stateOf(s, (sp) =>
              insert(sp, { sourceType: 'adapter', sourceRef: 'causelist:item' }),
            ),
            table,
          ).toBeUndefined();
        }
      });
    });
  });
});

describe('composite foreign keys (#347)', () => {
  it('rejects every parent and member of another workspace with a FK violation', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const bg = await inWorkspace(tx, b.id, async (s) => {
        const g = await newGraph(s, b.id);
        const listingId = await newListing(s, g);
        return {
          ...g,
          listingId,
          hearingId: await newHearing(s, g, listingId),
          orderId: await newOrder(s, g),
          obligationId: await newObligation(s, g),
        };
      });
      const bMember = bg.memberIds[0] ?? '';
      await inWorkspace(tx, a.id, async (s) => {
        const g = await newGraph(s, a.id);
        const lid = await newListing(s, g);
        const hid = await newHearing(s, g, lid);
        const cases: [string, (sp: Transaction) => Promise<unknown>][] = [
          [
            'listing.proceeding_id',
            (sp) => newListing(sp, { ...g, proceedingId: bg.proceedingId }),
          ],
          [
            'listing.source_document_id',
            (sp) => newListing(sp, g, { sourceDocumentId: bg.documentId }),
          ],
          ['hearing.listing_id', (sp) => newHearing(sp, g, bg.listingId)],
          [
            'appearance.hearing_id',
            (sp) =>
              sp
                .insert(appearance)
                .values({ workspaceId: a.id, hearingId: bg.hearingId, capacity: 'aor' }),
          ],
          [
            'appearance.member_id',
            (sp) =>
              sp.insert(appearance).values({
                workspaceId: a.id,
                hearingId: hid,
                memberId: bMember,
                capacity: 'proxy',
              }),
          ],
          ['order.proceeding_id', (sp) => newOrder(sp, { ...g, proceedingId: bg.proceedingId })],
          ['order.document_id', (sp) => newOrder(sp, { ...g, documentId: bg.documentId })],
          ['order.anchor_id', (sp) => newOrder(sp, g, { sourceType: 'ai', anchorId: bg.anchorId })],
          ['obligation.matter_id', (sp) => newObligation(sp, { ...g, matterId: bg.matterId })],
          [
            'obligation.proceeding_id',
            (sp) => newObligation(sp, g, { proceedingId: bg.proceedingId }),
          ],
          ['obligation.owner_member_id', (sp) => newObligation(sp, g, { ownerMemberId: bMember })],
          [
            'obligation.closed_by',
            (sp) =>
              newObligation(sp, g, {
                status: 'done',
                closedReasonType: 'lawyer_action',
                closedBy: bMember,
                closedAt: new Date(),
              }),
          ],
          [
            'obligation.source_order_id',
            (sp) => newObligation(sp, g, { sourceOrderId: bg.orderId }),
          ],
          ['task.matter_id', (sp) => newTask(sp, g, { matterId: bg.matterId })],
          ['task.proceeding_id', (sp) => newTask(sp, g, { proceedingId: bg.proceedingId })],
          ['task.owner_member_id', (sp) => newTask(sp, g, { ownerMemberId: bMember })],
          [
            'task.fulfils_obligation_id',
            (sp) => newTask(sp, g, { fulfilsObligationId: bg.obligationId }),
          ],
        ];
        for (const [column, insert] of cases) {
          expect(await stateOf(s, insert), column).toBe('23503');
        }
      });
    });
  });

  it('rejects a proceeding of another workspace even for the table owner', async () => {
    const a = await owner.transaction((o) => newWorkspaceAsOwner(o));
    try {
      const b = await owner.transaction((o) => newWorkspaceAsOwner(o));
      try {
        const bg = await owner.transaction(async (o) => {
          await o.execute(sql`select set_config('app.workspace_id', ${b.id}, true)`);
          return newGraph(o, b.id);
        });
        await owner.transaction(async (o) => {
          await o.execute(sql`select set_config('app.workspace_id', ${a.id}, true)`);
          const g = await newGraph(o, a.id);
          await newListing(o, g);
          expect(
            await stateOf(o, (sp) => newListing(sp, { ...g, proceedingId: bg.proceedingId })),
          ).toBe('23503');
          expect(await stateOf(o, (sp) => newObligation(sp, { ...g, matterId: bg.matterId }))).toBe(
            '23503',
          );
        });
      } finally {
        await dropWorkspaceAsOwner(b.id);
      }
    } finally {
      await dropWorkspaceAsOwner(a.id);
    }
  });
});

describe('order and task (#347)', () => {
  it('keeps operative_directions a JSON array and task status in its list', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const g = await newGraph(s, id);
        const oid = await newOrder(s, g, {
          operativeDirections: [{ text: 'File counter in 2 weeks', anchorId: g.anchorId }],
        });
        expect(
          await stateOf(s, (sp) =>
            sp.execute(
              sql`update "order" set operative_directions = '{}'::jsonb where id = ${oid}`,
            ),
          ),
        ).toBe('23514');
        await newTask(s, g, { status: 'done' });
        expect(
          await stateOf(s, (sp) =>
            sp.execute(
              sql`insert into task (workspace_id, title, status, source_type) values (${id}, 'x', 'blocked', 'manual')`,
            ),
          ),
        ).toBe('23514');
        expect(await stateOf(s, (sp) => newTask(sp, g, { title: '  ' }))).toBe('23514');
        expect(await stateOf(s, (sp) => newObligation(sp, g, { description: '' }))).toBe('23514');
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
    sql`insert into organization (id, name, slug) values (${id}, 'Chambers', ${`dk-${id}`})`,
  );
  await o.execute(
    sql`insert into member (workspace_id, user_id, role) values (${id}, ${u?.id ?? ''}, 'owner')`,
  );
  return { id };
}

/** Drops a committed workspace: the docket and graph rows first (NO ACTION parents), then the rest. */
async function dropWorkspaceAsOwner(id: string): Promise<void> {
  await owner.transaction(async (o) => {
    await o.execute(sql`select set_config('app.workspace_id', ${id}, true)`);
    const users = await o.execute<{ id: string }>(
      sql`select user_id as id from member where workspace_id = ${id}`,
    );
    for (const table of [
      'appearance',
      'hearing',
      'task',
      'obligation',
      'order',
      'listing',
      'proceeding',
      'anchor',
      'document',
      'matter',
      'court_hall',
      'bench',
      'forum',
    ]) {
      await o.execute(sql`delete from ${sql.identifier(table)} where workspace_id = ${id}`);
    }
    await o.execute(sql`delete from organization where id = ${id}`);
    for (const u of users) await o.execute(sql`delete from "user" where id = ${u.id}`);
  });
}

describe('migration 0041', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterAll(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('applies on a database migrated through 0040', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'causedeck-0040-'));
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
    const journalPath = path.join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    const head = journal.entries.findIndex((e) => e.tag === '0040_people');
    expect(head).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, head + 1);
    writeFileSync(journalPath, JSON.stringify(journal));

    const db = await createScratchDatabase(testDatabaseUrls(), 'docket_0040');
    cleanups.push(db.drop);
    const before = await runMigrations({ url: new Secret(db.owner), migrationsFolder: dir });
    expect(before.latest).toBe('0040_people');

    const scratch = createOwnerDb(new Secret(db.owner));
    cleanups.push(() => scratch.$client.end());
    // A proceeding written before the docket existed stays and can take listings afterwards.
    const ws = await scratch.transaction(async (o) => {
      const { id } = await newWorkspaceAsOwner(o);
      return newGraph(o, id);
    });

    const after = await runMigrations({ url: new Secret(db.owner) });
    expect(after.applied[0]).toBe('0041_docket');
    await scratch.transaction(async (o) => {
      await o.execute(sql`select set_config('app.workspace_id', ${ws.workspaceId}, true)`);
      await newListing(o, ws, { canonical: true });
      expect(await stateOf(o, (sp) => newListing(sp, ws, { canonical: true }))).toBe('23505');
      expect(
        await stateOf(o, (sp) =>
          sp.execute(
            sql`insert into obligation (workspace_id, matter_id, source, description, status, source_type) values (${ws.workspaceId}, ${ws.matterId}, 'client', 'Send fees', 'done', 'manual')`,
          ),
        ),
      ).toBe('23514');
    });
  }, 240_000);
});
