// Bench rosters (#384, part 1 of #39; ADR 0017): `bench_roster`, `bench_roster_entry` and
// `bench_change_alert` are tenant tables under FORCE RLS. The btree_gist exclusion constraint
// allows at most one active roster per workspace and forum on any day (half-open periods, a null
// end open-ended); status, reason, version and period checks; one alert per proceeding and roster;
// forum, hall and bench references scope-guarded to a catalogue or own row; entries cascading with
// their roster and the member and document references clearing only their own column.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Transaction } from '../client.ts';
import { createOwnerDb } from '../owner.ts';
import { member } from '../schema/auth.ts';
import { bench, courtHall, forum } from '../schema/court.ts';
import { document } from '../schema/documents.ts';
import { matter } from '../schema/matter-graph.ts';
import { proceeding } from '../schema/proceedings.ts';
import { benchChangeAlert, benchRoster, benchRosterEntry } from '../schema/roster.ts';
import { inWorkspace, testDatabaseUrls, withTestDb } from '../testing/index.ts';
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
        code: `test.roster.${TAG}`,
        court: 'Test High Court',
        jurisdictionKind: 'high_court',
      })
      .returning({ id: forum.id });
    if (f === undefined) throw new Error('catalogue forum insert failed');
    const [h] = await o
      .insert(courtHall)
      .values({ forumId: f.id, hallNo: '7' })
      .returning({ id: courtHall.id });
    const [b] = await o
      .insert(bench)
      .values({ forumId: f.id, judges: ['Judge C'], benchKind: 'division' })
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

const TABLES = ['bench_roster', 'bench_roster_entry', 'bench_change_alert'] as const;

/** The SQLSTATE of `fn` run in a savepoint (undefined when it succeeds). */
const stateOf = (s: Transaction, fn: (sp: Transaction) => Promise<unknown>) =>
  sqlState(s.transaction(fn));

const one = <T>(rows: T[], what: string): T => {
  const [row] = rows;
  if (row === undefined) throw new Error(`${what} insert returned no row`);
  return row;
};

interface Graph {
  workspaceId: string;
  forumId: string;
  hallId: string;
  benchId: string;
  proceedingId: string;
  documentId: string;
  memberId: string;
}

/** A custom forum with a hall and bench, a proceeding and a document of the workspace. */
async function newGraph(s: Transaction, workspaceId: string): Promise<Graph> {
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
      .values({ workspaceId, forumId, hallNo: '12A' })
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
  const { id: matterId } = one(
    await s
      .insert(matter)
      .values({ workspaceId, title: 'Petitioner v. State' })
      .returning({ id: matter.id }),
    'matter',
  );
  const { id: proceedingId } = one(
    await s
      .insert(proceeding)
      .values({ workspaceId, matterId, forumId, caseTypeCode: 'WP', sourceType: 'manual' })
      .returning({ id: proceeding.id }),
    'proceeding',
  );
  const { id: documentId } = one(
    await s
      .insert(document)
      .values({
        workspaceId,
        matterId,
        kind: 'other',
        storageKey: `ws/${workspaceId}/document/${randomUUID()}`,
        sha256: 'd'.repeat(64),
      })
      .returning({ id: document.id }),
    'document',
  );
  const { id: memberId } = one(
    await s.select({ id: member.id }).from(member).where(eq(member.organizationId, workspaceId)),
    'member',
  );
  return { workspaceId, forumId, hallId, benchId, proceedingId, documentId, memberId };
}

let version = 0;
const newRoster = async (
  s: Transaction,
  g: Graph,
  values: Partial<typeof benchRoster.$inferInsert> = {},
) =>
  one(
    await s
      .insert(benchRoster)
      .values({
        workspaceId: g.workspaceId,
        forumId: g.forumId,
        effectiveFrom: '2026-11-01',
        version: (version += 1),
        // Only a draft may stay `proposed` (bench_roster_confirmed_chk, #387).
        confirmationState: (values.status ?? 'draft') === 'draft' ? 'proposed' : 'confirmed',
        ...values,
      })
      .returning({ id: benchRoster.id }),
    'bench_roster',
  ).id;

const newEntry = async (
  s: Transaction,
  g: Graph,
  rosterId: string,
  values: Partial<typeof benchRosterEntry.$inferInsert> = {},
) =>
  one(
    await s
      .insert(benchRosterEntry)
      .values({
        workspaceId: g.workspaceId,
        rosterId,
        hallNo: '12A',
        benchId: g.benchId,
        ...values,
      })
      .returning({ id: benchRosterEntry.id }),
    'bench_roster_entry',
  ).id;

const newAlert = async (
  s: Transaction,
  g: Graph,
  rosterId: string,
  values: Partial<typeof benchChangeAlert.$inferInsert> = {},
) =>
  one(
    await s
      .insert(benchChangeAlert)
      .values({
        workspaceId: g.workspaceId,
        proceedingId: g.proceedingId,
        rosterId,
        newBenchId: g.benchId,
        reason: 'hall',
        ...values,
      })
      .returning({ id: benchChangeAlert.id }),
    'bench_change_alert',
  ).id;

describe('bench roster tables (#384)', () => {
  it('installs btree_gist and forces RLS with ws_isolation on all three tables', async () => {
    const ext = await owner.execute<{ name: string }>(
      sql`select extname::text as name from pg_extension where extname = 'btree_gist'`,
    );
    expect(ext).toEqual([{ name: 'btree_gist' }]);
    const rows = await owner.execute<{ name: string; enabled: boolean; forced: boolean }>(sql`
      select c.relname::text as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
        from pg_class c
       where c.relname in ('bench_roster', 'bench_roster_entry', 'bench_change_alert')
       order by 1`);
    expect(rows).toEqual([...TABLES].sort().map((name) => ({ name, enabled: true, forced: true })));
    const policies = await owner.execute<{ table: string }>(sql`
      select tablename::text as table from pg_policies
       where policyname = 'ws_isolation'
         and tablename in ('bench_roster', 'bench_roster_entry', 'bench_change_alert')
       order by 1`);
    expect(policies.map((p) => p.table)).toEqual([...TABLES].sort());
  });

  it('declares the exclusion constraint, the SET NULL columns and the scope guards', async () => {
    const rows = await owner.execute<{ name: string; def: string }>(sql`
      select conname::text as name, pg_get_constraintdef(oid) as def from pg_constraint
       where conname in ('bench_roster_active_period_excl', 'bench_roster_imported_by_fk',
                         'bench_roster_source_document_fk')
       order by 1`);
    expect(Object.fromEntries(rows.map((r) => [r.name, r.def]))).toEqual({
      bench_roster_active_period_excl:
        "EXCLUDE USING gist (workspace_id WITH =, forum_id WITH =, daterange(effective_from, effective_to, '[)'::text) WITH &&) WHERE ((status = 'active'::text))",
      bench_roster_imported_by_fk:
        'FOREIGN KEY (workspace_id, imported_by) REFERENCES member(workspace_id, id) ON DELETE SET NULL (imported_by)',
      bench_roster_source_document_fk:
        'FOREIGN KEY (workspace_id, source_document_id) REFERENCES document(workspace_id, id) ON DELETE SET NULL (source_document_id)',
    });
    const triggers = await owner.execute<{ name: string }>(sql`
      select tgname::text as name from pg_trigger
       where not tgisinternal
         and tgrelid in ('bench_roster'::regclass, 'bench_roster_entry'::regclass,
                         'bench_change_alert'::regclass)
       order by 1`);
    expect(triggers.map((t) => t.name)).toEqual([
      'bench_change_alert_new_bench_id_scope_guard',
      'bench_change_alert_old_bench_id_scope_guard',
      'bench_roster_entry_bench_id_scope_guard',
      'bench_roster_entry_hall_id_scope_guard',
      'bench_roster_forum_id_scope_guard',
    ]);
  });

  it('allows one active roster per workspace and forum on any day', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      await inWorkspace(tx, b.id, async (s) => {
        // Another workspace's active roster on the same catalogue forum does not collide.
        const bg = await newGraph(s, b.id);
        await newRoster(s, { ...bg, forumId: catalogue.forumId }, { status: 'active' });
      });
      await inWorkspace(tx, a.id, async (s) => {
        const g = await newGraph(s, a.id);
        const onCatalogue = { ...g, forumId: catalogue.forumId };
        await newRoster(s, onCatalogue, { status: 'active' });
        const november = await newRoster(s, g, {
          status: 'active',
          effectiveFrom: '2026-11-01',
          effectiveTo: '2026-12-01',
        });
        // Overlapping active rosters on one forum are rejected (23P01), adjacent ones are not.
        expect(
          await stateOf(s, (sp) =>
            newRoster(sp, g, {
              status: 'active',
              effectiveFrom: '2026-11-15',
              effectiveTo: '2026-11-20',
            }),
          ),
        ).toBe('23P01');
        expect(
          await stateOf(s, (sp) =>
            newRoster(sp, onCatalogue, { status: 'active', effectiveFrom: '2027-01-01' }),
          ),
        ).toBe('23P01');
        await newRoster(s, g, { status: 'active', effectiveFrom: '2026-12-01' });
        // The open-ended December roster blocks any later active one.
        expect(
          await stateOf(s, (sp) =>
            newRoster(sp, g, { status: 'active', effectiveFrom: '2030-06-01' }),
          ),
        ).toBe('23P01');
        // Draft and superseded rosters may overlap anything.
        await newRoster(s, g, { status: 'draft', effectiveFrom: '2026-11-10' });
        await newRoster(s, g, { status: 'superseded', effectiveFrom: '2026-11-10' });
        // Activating an overlapping draft is rejected too; another forum is independent.
        const draft = await newRoster(s, g, { effectiveFrom: '2026-11-20' });
        expect(
          await stateOf(s, (sp) =>
            sp
              .update(benchRoster)
              .set({ status: 'active', confirmationState: 'confirmed' })
              .where(eq(benchRoster.id, draft)),
          ),
        ).toBe('23P01');
        const other = await newGraph(s, a.id);
        await newRoster(s, other, { status: 'active', effectiveFrom: '2026-11-15' });
        // Superseding the November roster frees its period.
        await s
          .update(benchRoster)
          .set({ status: 'superseded' })
          .where(eq(benchRoster.id, november));
        await newRoster(s, g, {
          status: 'active',
          effectiveFrom: '2026-11-15',
          effectiveTo: '2026-12-01',
        });
      });
    });
  });

  it('checks status, version, period, hall number, portfolio rule and alert values', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const g = await newGraph(s, id);
        const rosterId = await newRoster(s, g);
        const bad = (q: ReturnType<typeof sql>) => stateOf(s, (sp) => sp.execute(q));
        expect(
          await bad(sql`update bench_roster set status = 'archived' where id = ${rosterId}`),
        ).toBe('23514');
        expect(await bad(sql`update bench_roster set version = 0 where id = ${rosterId}`)).toBe(
          '23514',
        );
        for (const to of ['2026-11-01', '2026-10-31']) {
          expect(
            await bad(sql`update bench_roster set effective_to = ${to} where id = ${rosterId}`),
            to,
          ).toBe('23514');
        }
        // One version number per workspace and forum.
        expect(await stateOf(s, (sp) => newRoster(sp, g, { version: version }))).toBe('23505');
        expect(await stateOf(s, (sp) => newEntry(sp, g, rosterId, { hallNo: '  ' }))).toBe('23514');
        const entryId = await newEntry(s, g, rosterId, {
          portfolioRule: { caseTypes: ['WP'], yearFrom: 2020 },
        });
        expect(
          await bad(
            sql`update bench_roster_entry set portfolio_rule = '["WP"]'::jsonb where id = ${entryId}`,
          ),
        ).toBe('23514');
        const alertId = await newAlert(s, g, rosterId);
        expect(
          await bad(sql`update bench_change_alert set reason = 'judge' where id = ${alertId}`),
        ).toBe('23514');
        expect(
          await bad(sql`update bench_change_alert set status = 'done' where id = ${alertId}`),
        ).toBe('23514');
        await s
          .update(benchChangeAlert)
          .set({ status: 'dismissed' })
          .where(eq(benchChangeAlert.id, alertId));
        // One alert per proceeding and roster.
        expect(await stateOf(s, (sp) => newAlert(sp, g, rosterId, { reason: 'portfolio' }))).toBe(
          '23505',
        );
      });
    });
  });

  it('records the confirmation state and lets only a draft stay proposed (#387)', async () => {
    const column = await owner.execute<{ type: string; def: string; nullable: string }>(sql`
      select udt_name::text as type, column_default as def, is_nullable as nullable
        from information_schema.columns
       where table_name = 'bench_roster' and column_name = 'confirmation_state'`);
    expect(column).toEqual([
      { type: 'confirmation_state', def: "'proposed'::confirmation_state", nullable: 'NO' },
    ]);
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const g = await newGraph(s, id);
        const draft = await newRoster(s, g);
        const [row] = await s
          .select({ state: benchRoster.confirmationState })
          .from(benchRoster)
          .where(eq(benchRoster.id, draft));
        expect(row?.state).toBe('proposed');
        // An active or superseded roster must have been confirmed.
        for (const status of ['active', 'superseded'] as const) {
          expect(
            await stateOf(s, (sp) =>
              newRoster(sp, g, {
                status,
                effectiveFrom: '2028-01-01',
                confirmationState: 'proposed',
              }),
            ),
            status,
          ).toBe('23514');
        }
        expect(
          await stateOf(s, (sp) =>
            sp.update(benchRoster).set({ status: 'active' }).where(eq(benchRoster.id, draft)),
          ),
        ).toBe('23514');
        await s
          .update(benchRoster)
          .set({ status: 'active', confirmationState: 'confirmed' })
          .where(eq(benchRoster.id, draft));
      });
    });
  });

  it('references a catalogue or own forum, hall and bench, never another workspace one', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const bg = await inWorkspace(tx, b.id, (s) => newGraph(s, b.id));
      await inWorkspace(tx, a.id, async (s) => {
        const g = await newGraph(s, a.id);
        const own = await newRoster(s, g);
        const cat = await newRoster(s, { ...g, forumId: catalogue.forumId });
        await newEntry(s, g, own, { hallId: g.hallId });
        await newEntry(s, g, cat, { hallId: catalogue.hallId, benchId: catalogue.benchId });
        await newAlert(s, g, own, { oldBenchId: catalogue.benchId });
        expect(await stateOf(s, (sp) => newRoster(sp, { ...g, forumId: bg.forumId }))).toBe(
          '23503',
        );
        expect(await stateOf(s, (sp) => newEntry(sp, g, own, { hallId: bg.hallId }))).toBe('23503');
        expect(await stateOf(s, (sp) => newEntry(sp, g, own, { benchId: bg.benchId }))).toBe(
          '23503',
        );
        expect(
          await stateOf(s, (sp) =>
            newAlert(sp, g, cat, { oldBenchId: bg.benchId, newBenchId: g.benchId }),
          ),
        ).toBe('23503');
        expect(await stateOf(s, (sp) => newAlert(sp, g, cat, { newBenchId: bg.benchId }))).toBe(
          '23503',
        );
        expect(
          await stateOf(s, (sp) =>
            sp.update(benchRoster).set({ forumId: bg.forumId }).where(eq(benchRoster.id, own)),
          ),
        ).toBe('23503');
      });
    });
  });

  it('cascades entries with their roster and clears only imported_by and source_document_id', async () => {
    await withTestDb(async (tx) => {
      const { id } = await newWorkspace(tx);
      await inWorkspace(tx, id, async (s) => {
        const g = await newGraph(s, id);
        const rosterId = await newRoster(s, g, {
          importedBy: g.memberId,
          sourceDocumentId: g.documentId,
        });
        await newEntry(s, g, rosterId);
        await newEntry(s, g, rosterId, { hallNo: '3' });

        await s.delete(document).where(eq(document.id, g.documentId));
        await s.delete(member).where(eq(member.id, g.memberId));
        const [row] = await s
          .select({
            workspaceId: benchRoster.workspaceId,
            importedBy: benchRoster.importedBy,
            sourceDocumentId: benchRoster.sourceDocumentId,
          })
          .from(benchRoster)
          .where(eq(benchRoster.id, rosterId));
        expect(row).toEqual({ workspaceId: id, importedBy: null, sourceDocumentId: null });

        // An alert keeps its roster: the erase deletes alerts first.
        const alertId = await newAlert(s, g, rosterId);
        expect(
          await stateOf(s, (sp) => sp.delete(benchRoster).where(eq(benchRoster.id, rosterId))),
        ).toBe('23503');
        await s.delete(benchChangeAlert).where(eq(benchChangeAlert.id, alertId));
        await s.delete(benchRoster).where(eq(benchRoster.id, rosterId));
        const left = await s
          .select({ id: benchRosterEntry.id })
          .from(benchRosterEntry)
          .where(eq(benchRosterEntry.rosterId, rosterId));
        expect(left).toEqual([]);
      });
    });
  });
});
