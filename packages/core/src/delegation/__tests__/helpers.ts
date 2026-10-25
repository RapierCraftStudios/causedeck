import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import {
  buildCourtHall,
  buildForum,
  buildListing,
  buildMatter,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';

import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';

export const DAY = '2026-11-02';

export async function memberIdOf(
  tx: Transaction,
  workspaceId: string,
  userId: string,
): Promise<string> {
  const rows = await inWorkspace(tx, workspaceId, (s) =>
    s.select({ id: schema.member.id, userId: schema.member.userId }).from(schema.member),
  );
  const found = rows.find((m) => m.userId === userId);
  if (found === undefined) throw new Error('member not found');
  return found.id;
}

/** A workspace with an owner, an advocate, a junior and a clerk, one forum and two halls. */
export async function seedChamber(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const advocateId = await addMember(tx, workspaceId, 'advocate');
  const juniorId = await addMember(tx, workspaceId, 'junior');
  const clerkId = await addMember(tx, workspaceId, 'clerk');
  const base = await inWorkspace(tx, workspaceId, async (s) => {
    const forum = await buildForum(s, workspaceId);
    const hall1 = await buildCourtHall(s, workspaceId, { forumId: forum.id, hallNo: '3' });
    const hall2 = await buildCourtHall(s, workspaceId, { forumId: forum.id, hallNo: '12A' });
    return { forumId: forum.id, hall1: hall1.id, hall2: hall2.id };
  });
  const members = {
    owner: await memberIdOf(tx, workspaceId, ownerId),
    advocate: await memberIdOf(tx, workspaceId, advocateId),
    junior: await memberIdOf(tx, workspaceId, juniorId),
    clerk: await memberIdOf(tx, workspaceId, clerkId),
  };
  const users = { owner: ownerId, advocate: advocateId, junior: juniorId, clerk: clerkId };
  /** A matter with one listed item; `allow` makes the matter restricted to those users. */
  async function listed(
    over: { hallId?: string; itemNo?: string; allow?: string[]; sensitive?: boolean } = {},
  ) {
    return inWorkspace(tx, workspaceId, async (s) => {
      const m = await buildMatter(s, workspaceId, {
        ownerMemberId: members.owner,
        ...(over.sensitive === undefined ? {} : { sensitive: over.sensitive }),
      });
      const p = await buildProceeding(s, workspaceId, {
        matterId: m.id,
        forumId: base.forumId,
        number: String(Math.floor(Math.random() * 9000) + 100),
        year: 2026,
      });
      const l = await buildListing(s, workspaceId, {
        proceedingId: p.id,
        listDate: DAY,
        hallId: over.hallId ?? base.hall1,
        itemNo: over.itemNo ?? '1',
      });
      if (over.allow !== undefined) {
        await s
          .insert(schema.matterRestriction)
          .values({ workspaceId, matterId: m.id, allowedUserIds: over.allow });
      }
      return { matterId: m.id, listingId: l.id };
    });
  }
  return { workspaceId, users, members, ...base, listed };
}
