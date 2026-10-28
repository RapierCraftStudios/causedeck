import { schema } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import { createStatusLink, extendStatusLink, listStatusLinks, revokeStatusLink } from '../create.ts';
import { purgeExpiredStatusLinks } from '../retention.ts';
import { chamber, deps, inWs, input, NOW } from './helpers.ts';

describe('status links across workspaces', () => {
  it('denies B on A: no read, no revoke, no extend, no create; A is unchanged', async () => {
    await withTestDb(async (tx) => {
      const a = await chamber(tx);
      const b = await newWorkspace(tx);
      const bActor = { userId: b.ownerId, workspaceId: b.workspaceId };
      const { id } = await createStatusLink(deps(tx), a.owner, input(a));
      await expect(listStatusLinks(deps(tx), bActor, a.matterId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(revokeStatusLink(deps(tx), bActor, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        extendStatusLink(deps(tx), bActor, { linkId: id, expiryDays: 30 }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(createStatusLink(deps(tx), bActor, input(a))).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      const [row] = await listStatusLinks(deps(tx), a.owner, a.matterId);
      expect(row).toMatchObject({ id, state: 'active' });
    });
  });

  it('a user of A acting with B as the workspace is a non-member', async () => {
    await withTestDb(async (tx) => {
      const a = await chamber(tx);
      const b = await newWorkspace(tx);
      await expect(
        listStatusLinks(deps(tx), { userId: a.owner.userId, workspaceId: b.workspaceId }, a.matterId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

describe('retention', () => {
  it('clears the payload of links expired 30 days, only', async () => {
    await withTestDb(async (tx) => {
      const a = await chamber(tx);
      const { id } = await createStatusLink(deps(tx), a.owner, input(a, { expiryDays: 1 }));
      const early = await purgeExpiredStatusLinks({ db: tx, now: () => new Date(NOW.getTime() + 20 * 86400000) }, a.workspaceId);
      expect(early.purged).toBe(0);
      const late = await purgeExpiredStatusLinks({ db: tx, now: () => new Date(NOW.getTime() + 32 * 86400000) }, a.workspaceId);
      expect(late.purged).toBe(1);
      const [row] = await inWs(tx, a.workspaceId, (t) => t.select().from(schema.statusLink));
      expect(row).toMatchObject({ id, payload: {} });
      expect(row?.purgedAt).not.toBeNull();
    });
  });
});
