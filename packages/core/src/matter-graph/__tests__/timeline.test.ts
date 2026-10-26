// The matter timeline (#366, part 5 of #33) on the test database: one chronologically sorted list
// across the matter's proceedings, with provenance and anchors from each source row, court-day
// bounds in Asia/Kolkata, a kinds filter, zod-validated input, NOT_FOUND outside what the actor may
// read, and no writes or events.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildAnchor,
  buildDocument,
  buildForum,
  buildHearing,
  buildListing,
  buildMatter,
  buildObligation,
  buildOrder,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  getMatterTimeline,
  restrictMatter,
  WorkspaceError,
  type GraphEvent,
  type MatterGraphDeps,
  type TimelineEvent,
} from '../../index.ts';
import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';

interface World {
  workspaceId: string;
  ownerId: string;
  owner: { userId: string; workspaceId: string };
  deps: MatterGraphDeps;
  events: GraphEvent[];
  matterId: string;
  p1: string;
  p2: string;
  anchorId: string;
  ids: Record<string, string>;
}

async function ownerMemberId(s: Transaction, workspaceId: string, userId: string) {
  const [row] = await s
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, workspaceId), eq(schema.member.userId, userId)));
  if (!row) throw new Error('member not found');
  return row.id;
}

/**
 * A matter with two proceedings and one fact of every produced kind, on known instants:
 *
 * - listing P1 2026-11-01 (anchored), with a hearing the same day: 2026-10-31T18:30Z
 * - state change P1 at 2026-11-01T04:00Z (09:30 IST)
 * - document of the matter at 2026-11-02T06:00Z (from a capture)
 * - order P2 2026-11-03
 * - matter-level obligation due 2026-11-05 (18:30Z the day before), and one of P2 closed at
 *   2026-11-04T19:00Z (00:30 IST 11-05)
 *
 * plus noise in another matter of the same workspace.
 */
async function world(tx: Transaction): Promise<World> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const events: GraphEvent[] = [];
  const deps: MatterGraphDeps = { db: tx, events: { emit: (e) => events.push(e) } };
  const seeded = await inWorkspace(tx, workspaceId, async (s) => {
    const forum = await buildForum(s, workspaceId);
    const m = await buildMatter(s, workspaceId);
    const other = await buildMatter(s, workspaceId);
    const p1 = await buildProceeding(s, workspaceId, { matterId: m.id, forumId: forum.id });
    const p2 = await buildProceeding(s, workspaceId, { matterId: m.id, forumId: forum.id });
    const otherP = await buildProceeding(s, workspaceId, { matterId: other.id, forumId: forum.id });
    const source = await buildDocument(s, workspaceId);
    const anchor = await buildAnchor(s, workspaceId, { documentId: source.id });
    const memberId = await ownerMemberId(s, workspaceId, ownerId);

    const listing = await buildListing(s, workspaceId, {
      proceedingId: p1.id,
      listDate: '2026-11-01',
      sourceType: 'document',
      anchorId: anchor.id,
      confidence: '0.900',
      confirmationState: 'confirmed',
    });
    const hearing = await buildHearing(s, workspaceId, {
      listingId: listing.id,
      heldOn: '2026-11-01',
      outcome: 'Adjourned',
    });
    const [change] = await s
      .insert(schema.proceedingStateChange)
      .values({
        workspaceId,
        proceedingId: p1.id,
        fromState: 'filed',
        toState: 'sr_fr',
        actorMemberId: memberId,
        changedAt: new Date('2026-11-01T04:00:00Z'),
        sourceType: 'manual',
        confirmationState: 'confirmed',
      })
      .returning();
    const doc = await buildDocument(s, workspaceId, {
      matterId: m.id,
      kind: 'pleading',
      createdAt: new Date('2026-11-02T06:00:00Z'),
    });
    const order = await buildOrder(s, workspaceId, {
      proceedingId: p2.id,
      documentId: doc.id,
      orderDate: '2026-11-03',
      sourceType: 'adapter',
      sourceRef: 'ecourts:order:1',
    });
    const due = await buildObligation(s, workspaceId, { matterId: m.id, dueDate: '2026-11-05' });
    const closed = await buildObligation(s, workspaceId, {
      matterId: m.id,
      proceedingId: p2.id,
      status: 'done',
      closedReasonType: 'lawyer_action',
      closedBy: memberId,
      closedAt: new Date('2026-11-04T19:00:00Z'),
    });
    // Noise: another matter's facts never appear.
    await buildListing(s, workspaceId, { proceedingId: otherP.id, listDate: '2026-11-01' });
    await buildObligation(s, workspaceId, { matterId: other.id, dueDate: '2026-11-05' });
    await buildDocument(s, workspaceId, { matterId: other.id });
    return {
      matterId: m.id,
      p1: p1.id,
      p2: p2.id,
      anchorId: anchor.id,
      ids: {
        listing: listing.id,
        hearing: hearing.id,
        state_change: change?.id ?? '',
        document_added: doc.id,
        order: order.id,
        obligation_due: due.id,
        obligation_closed: closed.id,
      },
    };
  });
  return { workspaceId, ownerId, owner: { userId: ownerId, workspaceId }, deps, events, ...seeded };
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

const kinds = (events: TimelineEvent[]) => events.map((e) => e.kind);

describe('getMatterTimeline (#366)', () => {
  it('sorts every kind chronologically across proceedings with provenance and anchors', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const timeline = await getMatterTimeline(w.deps, w.owner, { matterId: w.matterId });
      // The listing and hearing share 00:00 IST on 2026-11-01: listing ranks first.
      expect(kinds(timeline)).toEqual([
        'listing',
        'hearing',
        'state_change',
        'document_added',
        'order',
        'obligation_due',
        'obligation_closed',
      ]);
      expect(timeline.map((e) => e.id)).toEqual([
        w.ids.listing,
        w.ids.hearing,
        w.ids.state_change,
        w.ids.document_added,
        w.ids.order,
        w.ids.obligation_due,
        w.ids.obligation_closed,
      ]);
      expect(timeline.map((e) => e.proceedingId)).toEqual([
        w.p1,
        w.p1,
        w.p1,
        null,
        w.p2,
        null,
        w.p2,
      ]);
      expect(timeline.map((e) => e.date)).toEqual([
        '2026-11-01',
        '2026-11-01',
        '2026-11-01',
        '2026-11-02',
        '2026-11-03',
        '2026-11-05',
        '2026-11-05',
      ]);
      const [listing, , change, doc, order, , closed] = timeline;
      expect(listing?.at).toBe('2026-10-31T18:30:00.000Z');
      expect(listing?.anchorId).toBe(w.anchorId);
      expect(listing?.provenance).toEqual({
        sourceType: 'document',
        sourceRef: null,
        anchorId: w.anchorId,
        confidence: '0.900',
        confirmationState: 'confirmed',
      });
      expect(change).toMatchObject({ kind: 'state_change', from: 'filed', to: 'sr_fr' });
      expect(change?.at).toBe('2026-11-01T04:00:00.000Z');
      expect(doc?.provenance).toEqual({
        sourceType: 'manual',
        sourceRef: null,
        anchorId: null,
        confidence: null,
        confirmationState: 'confirmed',
      });
      expect(order?.provenance).toMatchObject({
        sourceType: 'adapter',
        sourceRef: 'ecourts:order:1',
      });
      expect(order?.anchorId).toBeNull();
      expect(closed).toMatchObject({
        kind: 'obligation_closed',
        closedReasonType: 'lawyer_action',
      });
      expect(timeline.every((e) => e.matterId === w.matterId)).toBe(true);
    });
  });

  it('bounds by inclusive court days in Asia/Kolkata', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const on = (from?: string, to?: string) =>
        getMatterTimeline(w.deps, w.owner, {
          matterId: w.matterId,
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        });
      // Closed at 2026-11-04T19:00Z is 00:30 IST on 2026-11-05.
      expect(kinds(await on('2026-11-05', '2026-11-05'))).toEqual([
        'obligation_due',
        'obligation_closed',
      ]);
      expect(kinds(await on(undefined, '2026-11-04'))).toEqual([
        'listing',
        'hearing',
        'state_change',
        'document_added',
        'order',
      ]);
      expect(kinds(await on('2026-11-02', '2026-11-03'))).toEqual(['document_added', 'order']);
      expect(await on('2026-12-01')).toEqual([]);
    });
  });

  it('returns only the requested kinds; bench_change is reserved and empty', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const of = (k: TimelineEvent['kind'][]) =>
        getMatterTimeline(w.deps, w.owner, { matterId: w.matterId, kinds: k });
      expect(kinds(await of(['order', 'state_change']))).toEqual(['state_change', 'order']);
      expect(await of(['bench_change'])).toEqual([]);
    });
  });

  it('validates its input', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const call = (input: unknown) =>
        codeOf(getMatterTimeline(w.deps, w.owner, input as { matterId: string }));
      expect(await call({ matterId: 'not-a-uuid' })).toBe('VALIDATION');
      expect(await call({ matterId: w.matterId, from: '2026-11-02', to: '2026-11-01' })).toBe(
        'VALIDATION',
      );
      expect(await call({ matterId: w.matterId, kinds: ['memo'] })).toBe('VALIDATION');
      expect(await call({ matterId: w.matterId, kinds: [] })).toBe('VALIDATION');
      expect(await call({ matterId: w.matterId, limit: 5 })).toBe('VALIDATION');
    });
  });

  it('is NOT_FOUND for another workspace or a restricted matter the actor may not read', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const other = await world(tx);
      // Another workspace's matter, from the actor's own workspace.
      expect(await codeOf(getMatterTimeline(w.deps, w.owner, { matterId: other.matterId }))).toBe(
        'NOT_FOUND',
      );
      // Claiming the other workspace without a membership there.
      expect(
        await codeOf(
          getMatterTimeline(
            w.deps,
            { userId: w.ownerId, workspaceId: other.workspaceId },
            { matterId: other.matterId },
          ),
        ),
      ).toBe('NOT_FOUND');
      const advocate = await addMember(tx, w.workspaceId, 'advocate');
      const asAdvocate = { userId: advocate, workspaceId: w.workspaceId };
      expect(await getMatterTimeline(w.deps, asAdvocate, { matterId: w.matterId })).toHaveLength(7);
      await restrictMatter(tx, w.owner, { matterId: w.matterId, allowedUserIds: [] });
      expect(await codeOf(getMatterTimeline(w.deps, asAdvocate, { matterId: w.matterId }))).toBe(
        'NOT_FOUND',
      );
    });
  });

  it('reads only: emits no events and changes no rows', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const snapshot = () =>
        inWorkspace(tx, w.workspaceId, async (s) => ({
          listing: await s.select().from(schema.listing).orderBy(schema.listing.id),
          obligation: await s.select().from(schema.obligation).orderBy(schema.obligation.id),
          document: await s.select().from(schema.document).orderBy(schema.document.id),
          proceeding: await s.select().from(schema.proceeding).orderBy(schema.proceeding.id),
        }));
      const before = await snapshot();
      await getMatterTimeline(w.deps, w.owner, { matterId: w.matterId });
      expect(w.events).toEqual([]);
      expect(await snapshot()).toEqual(before);
    });
  });
});
