import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { addMember } from '../../__tests__/fixtures.ts';
import { assembleBrief } from '../assemble.ts';
import { markPrepared, setBriefNote } from '../state.ts';

import { seedBrief } from './helpers.ts';

describe('briefs across workspaces (R14)', () => {
  it('denies B on A and leaves A unchanged', async () => {
    await withTestDb(async (tx) => {
      const a = await seedBrief(tx);
      const b = await seedBrief(tx);
      await setBriefNote({ db: tx }, a.actor, { listingId: a.fixture.listingId, note: 'A only' });
      const before = await inWorkspace(tx, a.workspaceId, (s) =>
        s.select().from(schema.briefState),
      );
      const asB = { userId: b.ownerId, workspaceId: a.workspaceId };
      await expect(assembleBrief({ db: tx }, asB, a.fixture.listingId)).rejects.toBeDefined();
      await expect(
        markPrepared({ db: tx }, asB, { listingId: a.fixture.listingId }),
      ).rejects.toBeDefined();
      // B's own scope cannot see A's listing.
      await expect(assembleBrief({ db: tx }, b.actor, a.fixture.listingId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(
        await inWorkspace(tx, a.workspaceId, (s) => s.select().from(schema.briefState)),
      ).toEqual(before);
    });
  });

  it('a user in both workspaces sees only the scoped one', async () => {
    await withTestDb(async (tx) => {
      const a = await seedBrief(tx);
      const b = await seedBrief(tx);
      const both = await addMember(tx, a.workspaceId, 'advocate');
      await addMember(tx, b.workspaceId, 'advocate').catch(() => undefined);
      await expect(
        assembleBrief(
          { db: tx },
          { userId: both, workspaceId: a.workspaceId },
          b.fixture.listingId,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
