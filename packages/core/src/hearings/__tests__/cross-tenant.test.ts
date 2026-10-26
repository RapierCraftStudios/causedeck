// Cross-tenant (#62): a user in both workspaces acting under B cannot read or confirm A's hearing outcome.
import { schema, withWorkspace } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { confirmOutcome, getOutcomeProposal } from '../index.ts';

import { addMember, world } from './support.ts';

describe('hearing outcome tenancy', () => {
  it("denies B's member, including one who belongs to both, and leaves A unchanged", async () => {
    await withTestDb(async (tx) => {
      const a = await world(tx);
      await a.stage();
      const b = await world(tx);
      const both = await addMember(tx, a.workspaceId, 'owner');
      await withWorkspace(tx, { workspaceId: b.workspaceId }, (s) =>
        s
          .insert(schema.member)
          .values({ organizationId: b.workspaceId, userId: both, role: 'owner' }),
      );
      const before = await inWorkspace(tx, a.workspaceId, (s) => s.select().from(schema.hearing));
      for (const userId of [b.ownerId, both]) {
        const actor = { userId, workspaceId: b.workspaceId };
        await expect(
          getOutcomeProposal(a.deps, actor, { hearingId: a.hearingId }),
        ).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
        await expect(
          confirmOutcome(a.deps, actor, {
            hearingId: a.hearingId,
            outcome: 'x',
            nextDate: { kind: 'none' },
          }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
      expect(await inWorkspace(tx, a.workspaceId, (s) => s.select().from(schema.hearing))).toEqual(
        before,
      );
    });
  });
});
