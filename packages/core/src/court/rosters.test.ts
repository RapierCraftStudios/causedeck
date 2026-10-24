// Roster services (#387, part 3 of #39; ADR 0017): confirming a reviewed roster in one transaction
// (benches found or created from normalised judges, the previous version superseded, provenance
// written, nothing written when any entry fails), supersede, and the day lookups that answer from
// the active or a superseded roster.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildBench,
  buildCourtHall,
  buildDocument,
  buildForum,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { addMember, newWorkspace } from '../__tests__/fixtures.ts';
import { WorkspaceError } from '../shared/errors.ts';

import {
  confirmRosterImport,
  getRosterAt,
  listRosters,
  resolveBenchForHall,
  supersede,
} from './rosters.ts';

const { bench, benchRoster, benchRosterEntry, member } = schema;

const JUDGE_A = "Hon'ble Mr. Justice A. B.  Venpa (fictional)";
const JUDGE_B = 'Hon. Justice K. Marudham (fictional)';

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorkspaceError);
  return (error as WorkspaceError).code;
}

interface Setup {
  workspaceId: string;
  ownerId: string;
  memberId: string;
  forumId: string;
  otherForumId: string;
  hallId: string;
  benchId: string;
  otherBenchId: string;
  documentId: string;
}

async function setup(tx: Transaction): Promise<Setup> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  return inWorkspace(tx, workspaceId, async (s) => {
    const forum = await buildForum(s, workspaceId);
    const other = await buildForum(s, workspaceId);
    const hall = await buildCourtHall(s, workspaceId, { forumId: forum.id, hallNo: '12A' });
    const existing = await buildBench(s, workspaceId, {
      forumId: forum.id,
      judges: ['Justice S. Mullai (fictional)'],
      benchKind: 'single',
    });
    const foreign = await buildBench(s, workspaceId, { forumId: other.id });
    const doc = await buildDocument(s, workspaceId);
    const [self] = await s
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, workspaceId), eq(member.userId, ownerId)));
    return {
      workspaceId,
      ownerId,
      memberId: self?.id ?? '',
      forumId: forum.id,
      otherForumId: other.id,
      hallId: hall.id,
      benchId: existing.id,
      otherBenchId: foreign.id,
      documentId: doc.id,
    };
  });
}

const actorOf = (d: Setup) => ({ userId: d.ownerId, workspaceId: d.workspaceId });

/** Rosters, entries and benches of the workspace, for "nothing changed" checks. */
async function state(tx: Transaction, workspaceId: string) {
  return inWorkspace(tx, workspaceId, async (s) => ({
    rosters: await s.select().from(benchRoster).orderBy(benchRoster.id),
    entries: await s.select().from(benchRosterEntry).orderBy(benchRosterEntry.id),
    benches: await s
      .select()
      .from(bench)
      .where(eq(bench.workspaceId, workspaceId))
      .orderBy(bench.id),
  }));
}

describe('confirmRosterImport (#387)', () => {
  it('creates missing benches, activates the roster and writes its provenance', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      const { roster, entries } = await confirmRosterImport(tx, actorOf(d), {
        forumId: d.forumId,
        effectiveFrom: '2026-11-01',
        sourceDocumentId: d.documentId,
        note: 'Sitting arrangement from 1 November',
        entries: [
          { hallNo: '12A', judges: [JUDGE_A, JUDGE_B], portfolioText: 'Writ petitions 2020-2024' },
          { hallNo: '3', benchId: d.benchId, portfolioRule: { caseTypes: ['CRP'] } },
          // The same judges again (printed differently) reuse the bench created above.
          { hallNo: '4', judges: ['Justice A.B. Venpa (fictional)', JUDGE_B] },
          // Equal to an existing bench of the forum once normalised: found, not created.
          { hallNo: '5', judges: ["Hon'ble Mrs. Justice S. Mullai (fictional)"] },
        ],
      });
      expect(roster).toMatchObject({
        workspaceId: d.workspaceId,
        forumId: d.forumId,
        effectiveFrom: '2026-11-01',
        effectiveTo: null,
        status: 'active',
        version: 1,
        sourceDocumentId: d.documentId,
        importedBy: d.memberId,
        confirmationState: 'confirmed',
        note: 'Sitting arrangement from 1 November',
      });
      expect(entries.map((e) => e.hallNo)).toEqual(['12A', '3', '4', '5']);
      const byHall = new Map(entries.map((e) => [e.hallNo, e]));
      // The hall number resolves to the forum's catalogue of halls; unknown halls stay unlinked.
      expect(byHall.get('12A')?.hallId).toBe(d.hallId);
      expect(byHall.get('3')).toMatchObject({
        hallId: null,
        benchId: d.benchId,
        portfolioRule: { caseTypes: ['CRP'] },
      });
      expect(byHall.get('5')?.benchId).toBe(d.benchId);
      const created = byHall.get('12A')?.benchId ?? '';
      expect(byHall.get('4')?.benchId).toBe(created);
      const benches = (await state(tx, d.workspaceId)).benches.filter((b) => b.id === created);
      expect(benches).toEqual([
        expect.objectContaining({
          forumId: d.forumId,
          workspaceId: d.workspaceId,
          benchKind: 'division',
          judges: ['Justice A.B. Venpa (fictional)', 'Justice K. Marudham (fictional)'],
        }),
      ]);
    });
  });

  it('supersedes the previous active roster at the new start, as the next version', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      const first = await confirmRosterImport(tx, actorOf(d), {
        forumId: d.forumId,
        effectiveFrom: '2026-11-01',
        entries: [{ hallNo: '12A', benchId: d.benchId }],
      });
      const second = await confirmRosterImport(tx, actorOf(d), {
        forumId: d.forumId,
        effectiveFrom: '2027-01-06',
        entries: [{ hallNo: '12A', judges: [JUDGE_B] }],
      });
      expect(second.roster).toMatchObject({ status: 'active', version: 2, effectiveTo: null });
      const rosters = await listRosters(tx, d.workspaceId, { forumId: d.forumId });
      expect(rosters.map((r) => [r.id, r.status, r.effectiveFrom, r.effectiveTo])).toEqual([
        [second.roster.id, 'active', '2027-01-06', null],
        [first.roster.id, 'superseded', '2026-11-01', '2027-01-06'],
      ]);
      // A superseded version keeps its entries as confirmed.
      const { entries } = await state(tx, d.workspaceId);
      expect(entries.filter((e) => e.rosterId === first.roster.id)).toEqual(first.entries);
      // Not newer than the current version: CONFLICT, nothing changes.
      const before = await state(tx, d.workspaceId);
      for (const effectiveFrom of ['2027-01-06', '2026-12-01']) {
        expect(
          await codeOf(
            confirmRosterImport(tx, actorOf(d), {
              forumId: d.forumId,
              effectiveFrom,
              entries: [{ hallNo: '1', benchId: d.benchId }],
            }),
          ),
          effectiveFrom,
        ).toBe('CONFLICT');
      }
      expect(await state(tx, d.workspaceId)).toEqual(before);
    });
  });

  it('writes nothing when any entry fails: partial confirmation is not possible', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      await confirmRosterImport(tx, actorOf(d), {
        forumId: d.forumId,
        effectiveFrom: '2026-11-01',
        entries: [{ hallNo: '12A', benchId: d.benchId }],
      });
      const before = await state(tx, d.workspaceId);
      // The first entry creates a bench before the second (another forum's bench) fails.
      expect(
        await codeOf(
          confirmRosterImport(tx, actorOf(d), {
            forumId: d.forumId,
            effectiveFrom: '2027-01-06',
            entries: [
              { hallNo: '12A', judges: [JUDGE_A] },
              { hallNo: '3', benchId: d.otherBenchId },
            ],
          }),
        ),
      ).toBe('VALIDATION');
      // A hall of another forum fails the same way.
      const otherHall = await inWorkspace(tx, d.workspaceId, (s) =>
        buildCourtHall(s, d.workspaceId, { forumId: d.otherForumId, hallNo: '9' }),
      );
      const afterHall = await state(tx, d.workspaceId);
      expect(
        await codeOf(
          confirmRosterImport(tx, actorOf(d), {
            forumId: d.forumId,
            effectiveFrom: '2027-01-06',
            entries: [
              { hallNo: '12A', judges: [JUDGE_A] },
              { hallNo: '9', hallId: otherHall.id, benchId: d.benchId },
            ],
          }),
        ),
      ).toBe('VALIDATION');
      expect(await state(tx, d.workspaceId)).toEqual(afterHall);
      expect(afterHall.rosters).toEqual(before.rosters);
      expect(afterHall.entries).toEqual(before.entries);
      expect(afterHall.benches).toEqual(before.benches);
      // Malformed input, an unknown forum or document: nothing written either.
      expect(
        await codeOf(
          confirmRosterImport(tx, actorOf(d), {
            forumId: d.forumId,
            effectiveFrom: '2027-01-06',
            entries: [],
          }),
        ),
      ).toBe('VALIDATION');
      expect(
        await codeOf(
          confirmRosterImport(tx, actorOf(d), {
            forumId: d.forumId,
            effectiveFrom: '2027-01-06',
            sourceDocumentId: d.forumId,
            entries: [{ hallNo: '1', benchId: d.benchId }],
          }),
        ),
      ).toBe('NOT_FOUND');
      expect(await state(tx, d.workspaceId)).toEqual(afterHall);
    });
  });

  it('needs matter.write', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      const viewer = await addMember(tx, d.workspaceId, 'viewer');
      const before = await state(tx, d.workspaceId);
      expect(
        await codeOf(
          confirmRosterImport(
            tx,
            { userId: viewer, workspaceId: d.workspaceId },
            {
              forumId: d.forumId,
              effectiveFrom: '2026-11-01',
              entries: [{ hallNo: '12A', judges: [JUDGE_A] }],
            },
          ),
        ),
      ).toBe('FORBIDDEN');
      expect(await state(tx, d.workspaceId)).toEqual(before);
    });
  });
});

describe('getRosterAt, resolveBenchForHall and listRosters (#387)', () => {
  it('answers current and historic days from the roster in force', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      const november = await confirmRosterImport(tx, actorOf(d), {
        forumId: d.forumId,
        effectiveFrom: '2026-11-01',
        entries: [
          { hallNo: '12A', benchId: d.benchId, portfolioText: 'Writs' },
          { hallNo: '3', judges: [JUDGE_B] },
        ],
      });
      const january = await confirmRosterImport(tx, actorOf(d), {
        forumId: d.forumId,
        effectiveFrom: '2027-01-06',
        entries: [{ hallNo: '12A', judges: [JUDGE_A, JUDGE_B] }],
      });
      const at = (on: string) => getRosterAt(tx, d.workspaceId, { forumId: d.forumId, on });
      expect(await at('2026-10-31')).toBeNull();
      expect((await at('2026-11-01'))?.roster.id).toBe(november.roster.id);
      expect((await at('2027-01-05'))?.roster.id).toBe(november.roster.id);
      expect((await at('2027-01-05'))?.entries).toEqual(november.entries);
      expect((await at('2027-01-06'))?.roster.id).toBe(january.roster.id);
      expect((await at('2030-06-01'))?.roster.id).toBe(january.roster.id);

      const hall = (on: string, hall: { hallNo?: string; hallId?: string }) =>
        resolveBenchForHall(tx, d.workspaceId, { forumId: d.forumId, on, ...hall });
      expect(await hall('2026-12-01', { hallNo: '12A' })).toMatchObject({
        rosterId: november.roster.id,
        benchId: d.benchId,
        hallId: d.hallId,
        hallNo: '12A',
        portfolioText: 'Writs',
      });
      expect((await hall('2026-12-01', { hallId: d.hallId }))?.benchId).toBe(d.benchId);
      expect((await hall('2027-02-01', { hallNo: ' 12A ' }))?.benchId).toBe(
        january.entries[0]?.benchId,
      );
      expect((await hall('2026-12-01', { hallNo: '3' }))?.benchId).toBe(
        november.entries.find((e) => e.hallNo === '3')?.benchId,
      );
      // Hall 3 is not on the January roster; no roster before November.
      expect(await hall('2027-02-01', { hallNo: '3' })).toBeNull();
      expect(await hall('2026-10-01', { hallNo: '12A' })).toBeNull();
      expect(await codeOf(hall('2026-12-01', {}))).toBe('VALIDATION');

      expect((await listRosters(tx, d.workspaceId, { status: 'active' })).map((r) => r.id)).toEqual(
        [january.roster.id],
      );
      expect(await listRosters(tx, d.workspaceId, { forumId: d.otherForumId })).toEqual([]);
      expect((await listRosters(tx, d.workspaceId)).map((r) => r.version)).toEqual([2, 1]);
    });
  });

  it('ignores draft rosters', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      await inWorkspace(tx, d.workspaceId, (s) =>
        s
          .insert(benchRoster)
          .values({
            workspaceId: d.workspaceId,
            forumId: d.forumId,
            effectiveFrom: '2026-11-01',
            version: 1,
          })
          .returning(),
      );
      expect(
        await getRosterAt(tx, d.workspaceId, { forumId: d.forumId, on: '2026-12-01' }),
      ).toBeNull();
      // The draft holds version 1, so the confirmed roster is version 2.
      const { roster } = await confirmRosterImport(tx, actorOf(d), {
        forumId: d.forumId,
        effectiveFrom: '2026-11-01',
        entries: [{ hallNo: '12A', benchId: d.benchId }],
      });
      expect(roster.version).toBe(2);
    });
  });
});

describe('supersede (#387)', () => {
  it('ends an active roster without touching its entries', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      const { roster, entries } = await confirmRosterImport(tx, actorOf(d), {
        forumId: d.forumId,
        effectiveFrom: '2026-11-01',
        effectiveTo: '2027-03-01',
        entries: [{ hallNo: '12A', benchId: d.benchId }],
      });
      for (const effectiveFrom of ['2026-11-01', '2026-10-01', '2027-03-02']) {
        expect(
          await codeOf(supersede(tx, actorOf(d), { rosterId: roster.id, effectiveFrom })),
          effectiveFrom,
        ).toBe('VALIDATION');
      }
      const ended = await supersede(tx, actorOf(d), {
        rosterId: roster.id,
        effectiveFrom: '2027-01-06',
      });
      expect(ended).toMatchObject({
        id: roster.id,
        status: 'superseded',
        effectiveTo: '2027-01-06',
        confirmationState: 'confirmed',
      });
      expect((await state(tx, d.workspaceId)).entries).toEqual(entries);
      // Only an active roster can be superseded; an unknown one is NOT_FOUND.
      expect(
        await codeOf(
          supersede(tx, actorOf(d), { rosterId: roster.id, effectiveFrom: '2026-12-01' }),
        ),
      ).toBe('CONFLICT');
      expect(
        await codeOf(
          supersede(tx, actorOf(d), { rosterId: d.benchId, effectiveFrom: '2026-12-01' }),
        ),
      ).toBe('NOT_FOUND');
      const viewer = await addMember(tx, d.workspaceId, 'viewer');
      expect(
        await codeOf(
          supersede(
            tx,
            { userId: viewer, workspaceId: d.workspaceId },
            { rosterId: roster.id, effectiveFrom: '2026-12-01' },
          ),
        ),
      ).toBe('FORBIDDEN');
      // The day lookups still answer from it for its period.
      expect(
        (await getRosterAt(tx, d.workspaceId, { forumId: d.forumId, on: '2027-01-05' }))?.roster.id,
      ).toBe(roster.id);
      expect(
        await getRosterAt(tx, d.workspaceId, { forumId: d.forumId, on: '2027-01-06' }),
      ).toBeNull();
    });
  });
});
