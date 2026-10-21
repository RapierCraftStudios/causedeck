// The canonical next date (#364, part 3 of #33) on the test database: a proposal never changes the
// canonical listing (a different date is a conflict, the same date a no-op), only confirmNextDate
// swaps the canonical flag (the old row stays as history), it needs a member who may write the
// matter and refuses past dates unless allowPast, and events carry the matter's sensitive flag.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  confirmNextDate,
  createMatter,
  createProceeding,
  getCanonicalNextDate,
  proposeNextDate,
  WorkspaceError,
  type GraphEvent,
  type MatterGraphDeps,
} from '../../index.ts';
import { addMember, newUser, newWorkspace } from '../../__tests__/fixtures.ts';

const MANUAL = { sourceType: 'manual' } as const;
/** 2026-10-21 in Asia/Kolkata (11:30 IST). */
const NOW = new Date('2026-10-21T06:00:00Z');

interface World {
  workspaceId: string;
  ownerId: string;
  events: GraphEvent[];
  deps: MatterGraphDeps;
  owner: { userId: string; workspaceId: string };
  proceedingId: string;
  matterId: string;
  listings: () => Promise<(typeof schema.listing.$inferSelect)[]>;
}

async function world(tx: Transaction, sensitive = false): Promise<World> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const events: GraphEvent[] = [];
  const deps: MatterGraphDeps = { db: tx, events: { emit: (e) => events.push(e) }, now: () => NOW };
  const owner = { userId: ownerId, workspaceId };
  const m = await createMatter(deps, owner, { title: 'Fictional v. State', sensitive });
  const p = await createProceeding(deps, owner, {
    matterId: m.id,
    forumId: forum.id,
    caseType: 'W.P.',
    number: '101',
    year: 2026,
    provenance: MANUAL,
  });
  events.length = 0;
  return {
    workspaceId,
    ownerId,
    events,
    deps,
    owner,
    proceedingId: p.id,
    matterId: m.id,
    listings: () =>
      inWorkspace(tx, workspaceId, (s) =>
        s
          .select()
          .from(schema.listing)
          .where(eq(schema.listing.proceedingId, p.id))
          .orderBy(schema.listing.listDate, schema.listing.id),
      ),
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error === undefined) return undefined;
  expect(error).toBeInstanceOf(WorkspaceError);
  return (error as WorkspaceError).code;
}

describe('proposeNextDate', () => {
  it('creates a proposed, non-canonical listing when there is no canonical one', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx, true);
      const result = await proposeNextDate(w.deps, w.owner, {
        proceedingId: w.proceedingId,
        date: '2026-11-02',
        provenance: MANUAL,
      });
      expect(result.kind).toBe('proposal');
      const rows = await w.listings();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        listDate: '2026-11-02',
        canonical: false,
        confirmationState: 'proposed',
        listType: 'daily',
      });
      expect(result).toEqual({ kind: 'proposal', listingId: rows[0]?.id });
      expect(w.events).toEqual([
        {
          type: 'listing.next_date_proposed',
          workspaceId: w.workspaceId,
          actorUserId: w.ownerId,
          matterId: w.matterId,
          sensitive: true,
          proceedingId: w.proceedingId,
          listingId: rows[0]?.id,
          date: '2026-11-02',
        },
      ]);
      // The same proposal again finds the earlier one.
      const again = await proposeNextDate(w.deps, w.owner, {
        proceedingId: w.proceedingId,
        date: '2026-11-02',
        provenance: MANUAL,
      });
      expect(again).toEqual(result);
      expect(await w.listings()).toHaveLength(1);
    });
  });

  it('is a noop for the canonical date and a conflict for another, never touching it', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const first = await proposeNextDate(w.deps, w.owner, {
        proceedingId: w.proceedingId,
        date: '2026-11-02',
        provenance: MANUAL,
      });
      if (first.kind !== 'proposal') throw new Error('expected a proposal');
      await confirmNextDate(w.deps, w.owner, { listingId: first.listingId });
      const [canonicalBefore] = await w.listings();
      w.events.length = 0;

      const same = await proposeNextDate(w.deps, w.owner, {
        proceedingId: w.proceedingId,
        date: '2026-11-02',
        provenance: { sourceType: 'adapter', sourceRef: 'cause-list:1' },
      });
      expect(same).toEqual({ kind: 'noop' });
      expect(await w.listings()).toEqual([canonicalBefore]);
      expect(w.events).toEqual([]);

      const other = await proposeNextDate(w.deps, w.owner, {
        proceedingId: w.proceedingId,
        date: '2026-11-09',
        provenance: { sourceType: 'adapter', sourceRef: 'cause-list:2' },
      });
      if (other.kind !== 'conflict') throw new Error('expected a conflict');
      const rows = await w.listings();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(canonicalBefore);
      expect(other.current).toEqual({
        listingId: canonicalBefore?.id,
        proceedingId: w.proceedingId,
        date: '2026-11-02',
        canonical: true,
        sourceType: 'manual',
        confirmationState: 'confirmed',
      });
      expect(other.proposed).toMatchObject({
        listingId: rows[1]?.id,
        date: '2026-11-09',
        canonical: false,
        sourceType: 'adapter',
        confirmationState: 'proposed',
      });
      expect(w.events).toEqual([
        {
          type: 'listing.next_date_conflict',
          workspaceId: w.workspaceId,
          actorUserId: w.ownerId,
          matterId: w.matterId,
          sensitive: false,
          proceedingId: w.proceedingId,
          currentListingId: canonicalBefore?.id,
          proposedListingId: rows[1]?.id,
          currentDate: '2026-11-02',
          proposedDate: '2026-11-09',
        },
      ]);
    });
  });

  it('refuses invalid input, viewers and non-members', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const input = { proceedingId: w.proceedingId, date: '2026-11-02', provenance: MANUAL };
      expect(await codeOf(proposeNextDate(w.deps, w.owner, { ...input, date: '2 Nov 2026' }))).toBe(
        'VALIDATION',
      );
      expect(
        await codeOf(
          proposeNextDate(w.deps, w.owner, {
            ...input,
            provenance: { sourceType: 'manual', confirmationState: 'confirmed' },
          }),
        ),
      ).toBe('VALIDATION');
      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      expect(await codeOf(proposeNextDate(w.deps, { ...w.owner, userId: viewer }, input))).toBe(
        'FORBIDDEN',
      );
      const outsider = await newUser(tx);
      expect(await codeOf(proposeNextDate(w.deps, { ...w.owner, userId: outsider }, input))).toBe(
        'NOT_FOUND',
      );
      expect(await w.listings()).toEqual([]);
      expect(w.events).toEqual([]);
    });
  });
});

describe('confirmNextDate', () => {
  it('swaps the canonical flag atomically; the old row stays as history', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx, true);
      const propose = async (date: string) => {
        const r = await proposeNextDate(w.deps, w.owner, {
          proceedingId: w.proceedingId,
          date,
          provenance: MANUAL,
        });
        if (r.kind === 'noop') throw new Error('unexpected noop');
        return r.kind === 'proposal' ? r.listingId : r.proposed.listingId;
      };
      const firstId = await propose('2026-11-02');
      const first = await confirmNextDate(w.deps, w.owner, { listingId: firstId });
      expect(first).toMatchObject({ id: firstId, canonical: true, confirmationState: 'confirmed' });
      expect(w.events.at(-1)).toEqual({
        type: 'listing.next_date_confirmed',
        workspaceId: w.workspaceId,
        actorUserId: w.ownerId,
        matterId: w.matterId,
        sensitive: true,
        proceedingId: w.proceedingId,
        listingId: firstId,
        previousListingId: null,
        date: '2026-11-02',
      });

      const secondId = await propose('2026-11-09');
      const advocate = await addMember(tx, w.workspaceId, 'advocate');
      await confirmNextDate(w.deps, { ...w.owner, userId: advocate }, { listingId: secondId });
      const rows = await w.listings();
      expect(rows.map((r) => [r.id, r.canonical, r.listDate])).toEqual([
        [firstId, false, '2026-11-02'],
        [secondId, true, '2026-11-09'],
      ]);
      expect(rows.filter((r) => r.canonical)).toHaveLength(1);
      expect(w.events.at(-1)).toMatchObject({
        type: 'listing.next_date_confirmed',
        actorUserId: advocate,
        listingId: secondId,
        previousListingId: firstId,
      });
      expect(
        await getCanonicalNextDate(w.deps, w.owner, { proceedingId: w.proceedingId }),
      ).toMatchObject({ id: secondId, listDate: '2026-11-09' });

      // Confirming the canonical, confirmed listing again changes nothing.
      const count = w.events.length;
      await confirmNextDate(w.deps, w.owner, { listingId: secondId });
      expect(await w.listings()).toEqual(rows);
      expect(w.events).toHaveLength(count);
    });
  });

  it('rejects a past date unless allowPast, viewers and non-members, writing nothing', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const r = await proposeNextDate(w.deps, w.owner, {
        proceedingId: w.proceedingId,
        date: '2026-10-20',
        provenance: MANUAL,
      });
      if (r.kind !== 'proposal') throw new Error('expected a proposal');
      const before = await w.listings();
      w.events.length = 0;

      expect(await codeOf(confirmNextDate(w.deps, w.owner, { listingId: r.listingId }))).toBe(
        'VALIDATION',
      );
      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      expect(
        await codeOf(
          confirmNextDate(
            w.deps,
            { ...w.owner, userId: viewer },
            { listingId: r.listingId, allowPast: true },
          ),
        ),
      ).toBe('FORBIDDEN');
      const outsider = await newUser(tx);
      expect(
        await codeOf(
          confirmNextDate(
            w.deps,
            { ...w.owner, userId: outsider },
            { listingId: r.listingId, allowPast: true },
          ),
        ),
      ).toBe('NOT_FOUND');
      expect(await codeOf(confirmNextDate(w.deps, w.owner, { listingId: 'not-a-uuid' }))).toBe(
        'VALIDATION',
      );
      expect(await w.listings()).toEqual(before);
      expect(w.events).toEqual([]);

      const confirmed = await confirmNextDate(w.deps, w.owner, {
        listingId: r.listingId,
        allowPast: true,
      });
      expect(confirmed).toMatchObject({ canonical: true, listDate: '2026-10-20' });
      // Today (Asia/Kolkata) is not in the past.
      const today = await proposeNextDate(w.deps, w.owner, {
        proceedingId: w.proceedingId,
        date: '2026-10-21',
        provenance: MANUAL,
      });
      if (today.kind !== 'conflict') throw new Error('expected a conflict');
      await confirmNextDate(w.deps, w.owner, { listingId: today.proposed.listingId });
      const canonical = await inWorkspace(tx, w.workspaceId, (s) =>
        s
          .select({ listDate: schema.listing.listDate })
          .from(schema.listing)
          .where(
            and(
              eq(schema.listing.proceedingId, w.proceedingId),
              eq(schema.listing.canonical, true),
            ),
          ),
      );
      expect(canonical).toEqual([{ listDate: '2026-10-21' }]);
    });
  });
});

describe('getCanonicalNextDate', () => {
  it('returns null without a canonical listing and NOT_FOUND outside the workspace', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      expect(await getCanonicalNextDate(w.deps, w.owner, { proceedingId: w.proceedingId })).toBe(
        null,
      );
      const outsider = await newUser(tx);
      expect(
        await codeOf(
          getCanonicalNextDate(
            w.deps,
            { ...w.owner, userId: outsider },
            { proceedingId: w.proceedingId },
          ),
        ),
      ).toBe('NOT_FOUND');
      const other = await newWorkspace(tx);
      expect(
        await codeOf(
          getCanonicalNextDate(
            w.deps,
            { userId: other.ownerId, workspaceId: other.workspaceId },
            { proceedingId: w.proceedingId },
          ),
        ),
      ).toBe('NOT_FOUND');
    });
  });
});
