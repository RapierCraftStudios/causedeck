import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { addMember } from '../../__tests__/fixtures.ts';
import { generateHandover, recordView, saveHandover, whatChangedSince } from '../index.ts';

import { seedContinuity } from './helpers.ts';

describe('continuity across workspaces (R15)', () => {
  it('denies B on A and leaves A unchanged', async () => {
    await withTestDb(async (tx) => {
      const a = await seedContinuity(tx);
      const b = await seedContinuity(tx);
      const asB = { userId: b.ownerId, workspaceId: a.workspaceId };
      await expect(generateHandover(a.deps, asB, a.fixture.matterId)).rejects.toBeDefined();
      await expect(recordView(a.deps, asB, { matterId: a.fixture.matterId })).rejects.toBeDefined();
      await expect(
        saveHandover(a.deps, asB, {
          matterId: a.fixture.matterId,
          recipientMemberId: a.ownerMemberId,
        }),
      ).rejects.toBeDefined();
      // B's own scope cannot see A's matter.
      await expect(generateHandover(b.deps, b.actor, a.fixture.matterId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        whatChangedSince(b.deps, b.actor, a.fixture.matterId, new Date(0)),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(
        await inWorkspace(tx, a.workspaceId, (s) => s.select().from(schema.matterView)),
      ).toEqual([]);
      expect(
        await inWorkspace(tx, a.workspaceId, (s) => s.select().from(schema.handoverNote)),
      ).toEqual([]);
    });
  });

  it('a user in both workspaces sees only the scoped one', async () => {
    await withTestDb(async (tx) => {
      const a = await seedContinuity(tx);
      const b = await seedContinuity(tx);
      const both = await addMember(tx, a.workspaceId, 'advocate');
      await addMember(tx, b.workspaceId, 'advocate').catch(() => undefined);
      await expect(
        generateHandover(a.deps, { userId: both, workspaceId: a.workspaceId }, b.fixture.matterId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
