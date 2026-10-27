// Shared seeding for the continuity tests (#71): the brief fixture workspace on 2026-10-26.
import { schema, type Transaction } from '@causedeck/db';
import { insertBriefFixture } from '@causedeck/db/seed/brief-fixtures';
import { inWorkspace } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';

import { newWorkspace } from '../../__tests__/fixtures.ts';

export const NOW = new Date('2026-10-26T06:00:00Z');
export const now = () => NOW;

export async function memberIdOf(tx: Transaction, workspaceId: string, userId: string) {
  const [m] = await inWorkspace(tx, workspaceId, (s) =>
    s.select().from(schema.member).where(eq(schema.member.userId, userId)),
  );
  if (m === undefined) throw new Error('member');
  return m.id;
}

export async function seedContinuity(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const ownerMemberId = await memberIdOf(tx, workspaceId, ownerId);
  const fixture = await inWorkspace(tx, workspaceId, (s) =>
    insertBriefFixture(s, { workspaceId, ownerMemberId, date: '2026-10-26' }),
  );
  return {
    ownerId,
    ownerMemberId,
    workspaceId,
    actor: { userId: ownerId, workspaceId },
    fixture,
    deps: { db: tx, now },
  };
}
