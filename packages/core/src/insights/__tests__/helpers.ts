// Shared world for the practice insights tests (#85): a workspace with one member of every role, one
// proceeding and builders for a hearing (with its brief state, appearances and the order its
// directions come from) and for obligations drawn from that order.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import {
  buildDocument,
  buildForum,
  buildHearing,
  buildListing,
  buildMatter,
  buildObligation,
  buildOrder,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { eq } from 'drizzle-orm';

import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';

/** 11:30 IST on 2026-11-10. */
export const NOW = new Date('2026-11-10T06:00:00Z');

export type World = Awaited<ReturnType<typeof insightsWorld>>;

export async function insightsWorld(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const advocateId = await addMember(tx, workspaceId, 'advocate');
  const juniorId = await addMember(tx, workspaceId, 'junior');
  const clerkId = await addMember(tx, workspaceId, 'clerk');
  const viewerId = await addMember(tx, workspaceId, 'viewer');
  // Long before NOW, so no rating counts as baseline unless a test sets the flag.
  await inWorkspace(tx, workspaceId, (s) =>
    s
      .update(schema.organization)
      .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(schema.organization.id, workspaceId)),
  );
  const memberOf = async (userId: string) => {
    const [row] = await inWorkspace(tx, workspaceId, (s) =>
      s
        .select({ id: schema.member.id })
        .from(schema.member)
        .where(eq(schema.member.userId, userId)),
    );
    return String(row?.id);
  };
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const matter = await inWorkspace(tx, workspaceId, (s) => buildMatter(s, workspaceId));
  const proceeding = await inWorkspace(tx, workspaceId, (s) =>
    buildProceeding(s, workspaceId, { matterId: matter.id, forumId: forum.id, state: 'sr_fr' }),
  );
  const document = await inWorkspace(tx, workspaceId, (s) => buildDocument(s, workspaceId));
  return {
    tx,
    workspaceId,
    matterId: matter.id,
    proceedingId: proceeding.id,
    documentId: document.id,
    owner: { userId: ownerId, workspaceId },
    advocate: { userId: advocateId, workspaceId },
    junior: { userId: juniorId, workspaceId },
    clerk: { userId: clerkId, workspaceId },
    viewer: { userId: viewerId, workspaceId },
    ownerMember: await memberOf(ownerId),
    advocateMember: await memberOf(advocateId),
    juniorMember: await memberOf(juniorId),
  };
}

export interface HearingOptions {
  heldOn: string;
  /** Members with an appearance at the hearing. */
  appearing: string[];
  /** When the brief was confirmed; null: never. */
  preparedAt?: Date | null;
}

/** A listing and hearing on `heldOn` with the order its directions come from. */
export async function addHearing(w: World, options: HearingOptions) {
  const { workspaceId } = w;
  return inWorkspace(w.tx, workspaceId, async (s) => {
    const listing = await buildListing(s, workspaceId, {
      proceedingId: w.proceedingId,
      listDate: options.heldOn,
    });
    const hearing = await buildHearing(s, workspaceId, {
      listingId: listing.id,
      heldOn: options.heldOn,
    });
    for (const memberId of options.appearing)
      await s
        .insert(schema.appearance)
        .values({ workspaceId, hearingId: hearing.id, memberId, capacity: 'arguing' });
    if (options.preparedAt)
      await s
        .insert(schema.briefState)
        .values({ workspaceId, listingId: listing.id, preparedAt: options.preparedAt });
    const order = await buildOrder(s, workspaceId, {
      proceedingId: w.proceedingId,
      documentId: w.documentId,
      orderDate: options.heldOn,
    });
    return { hearingId: hearing.id, orderId: order.id };
  });
}

export interface DirectionOptions {
  orderId: string;
  status?: 'open' | 'done' | 'not_applicable';
  /** Member id; null for none. */
  owner: string | null;
  dueDate: string | null;
  /** Deliberate reschedules recorded for it. */
  reschedules?: { at: Date }[];
  /** Closing member, for a closed obligation. */
  closer?: string;
}

/** An obligation drawn from the order, as the extraction pipeline would capture it. */
export async function addDirection(w: World, options: DirectionOptions) {
  const status = options.status ?? 'open';
  return inWorkspace(w.tx, w.workspaceId, async (s) => {
    const row = await buildObligation(s, w.workspaceId, {
      matterId: w.matterId,
      proceedingId: w.proceedingId,
      sourceOrderId: options.orderId,
      ownerMemberId: options.owner,
      dueDate: options.dueDate,
      ...(status === 'open'
        ? {}
        : {
            status,
            closedReasonType: status === 'done' ? 'task_completed' : 'not_applicable',
            closedAt: new Date('2026-11-05T05:00:00Z'),
            closedBy: options.closer ?? w.ownerMember,
            closedNote: status === 'not_applicable' ? 'No longer needed' : null,
          }),
    });
    for (const r of options.reschedules ?? [])
      await s.insert(schema.obligationEvent).values({
        workspaceId: w.workspaceId,
        obligationId: row.id,
        kind: 'rescheduled',
        fromValue: options.dueDate,
        toValue: '2026-12-31',
        reason: 'Client asked for time',
        at: r.at,
      });
    return row.id;
  });
}
