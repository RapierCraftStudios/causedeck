// Shared seeding for the briefs tests (#60): a workspace with the brief fixture on 2026-10-26.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import { insertBriefFixture } from '@causedeck/db/seed/brief-fixtures';
import { eq } from 'drizzle-orm';

import { newWorkspace } from '../../__tests__/fixtures.ts';

export const LISTING_DATE = '2026-10-26';

export async function seedBrief(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const fixture = await inWorkspace(tx, workspaceId, async (s) => {
    const [m] = await s.select().from(schema.member).where(eq(schema.member.userId, ownerId));
    if (m === undefined) throw new Error('owner member');
    return insertBriefFixture(s, {
      workspaceId,
      ownerMemberId: m.id,
      date: LISTING_DATE,
    });
  });
  return { ownerId, workspaceId, actor: { userId: ownerId, workspaceId }, fixture };
}
