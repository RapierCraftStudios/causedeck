// Shared world for the proof-of-value tests (#86): a workspace with an owner, an advocate, a viewer
// and a hearing at which the owner and the advocate each have an appearance.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import {
  buildForum,
  buildHearing,
  buildListing,
  buildMatter,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { eq } from 'drizzle-orm';

import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';

export const NOW = new Date('2026-11-10T06:00:00Z');

export async function povWorld(tx: Transaction, memberCount = 1) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  // The workspace is one day old at NOW: inside the 7-day baseline.
  await inWorkspace(tx, workspaceId, (s) =>
    s
      .update(schema.organization)
      .set({ createdAt: new Date(NOW.getTime() - 86400000) })
      .where(eq(schema.organization.id, workspaceId)),
  );
  const advocateId = await addMember(tx, workspaceId, 'advocate');
  const viewerId = await addMember(tx, workspaceId, 'viewer');
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const matter = await inWorkspace(tx, workspaceId, (s) => buildMatter(s, workspaceId));
  const proceeding = await inWorkspace(tx, workspaceId, (s) =>
    buildProceeding(s, workspaceId, { matterId: matter.id, forumId: forum.id, state: 'sr_fr' }),
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
  const hearings: string[] = [];
  for (let i = 0; i < memberCount; i++) {
    const listing = await inWorkspace(tx, workspaceId, (s) =>
      buildListing(s, workspaceId, { proceedingId: proceeding.id }),
    );
    const hearing = await inWorkspace(tx, workspaceId, (s) =>
      buildHearing(s, workspaceId, { listingId: listing.id }),
    );
    for (const userId of [ownerId, advocateId])
      await inWorkspace(tx, workspaceId, async (s) =>
        s.insert(schema.appearance).values({
          workspaceId,
          hearingId: hearing.id,
          memberId: await memberOf(userId),
          capacity: 'arguing',
        }),
      );
    hearings.push(hearing.id);
  }
  return {
    workspaceId,
    matterId: matter.id,
    hearings,
    owner: { userId: ownerId, workspaceId },
    advocate: { userId: advocateId, workspaceId },
    viewer: { userId: viewerId, workspaceId },
  };
}
