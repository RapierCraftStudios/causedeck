import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { assignAppearance } from '../assign.ts';
import { suggestAssignments } from '../suggest.ts';

import { DAY, seedChamber } from './helpers.ts';

describe('suggestAssignments (R3)', () => {
  it('proposes a different member for a hall clash with a one-line reason and writes nothing', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const a = await c.listed({ hallId: c.hall1, itemNo: '1' });
      const b = await c.listed({ hallId: c.hall2, itemNo: '4' });
      const actor = { userId: c.users.owner, workspaceId: c.workspaceId };
      for (const l of [a, b]) {
        await assignAppearance({ db: tx }, actor, {
          listingId: l.listingId,
          memberId: c.members.advocate,
          capacity: 'arguing',
        });
      }
      const before = await inWorkspace(tx, c.workspaceId, (s) => s.select().from(schema.appearance));
      const out = await suggestAssignments({ db: tx }, actor, { date: DAY });
      const clash = out.suggestions.filter((s) => s.kind === 'hall_clash');
      expect(clash).toHaveLength(1);
      expect(clash[0]?.memberId).not.toBe(c.members.advocate);
      expect(clash[0]?.reason).not.toContain('\n');
      expect(
        await inWorkspace(tx, c.workspaceId, (s) => s.select().from(schema.appearance)),
      ).toEqual(before);
    });
  });

  it('proposes someone for an unassigned item and never a member who cannot see the matter', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const { listingId } = await c.listed({ allow: [c.users.owner] });
      const out = await suggestAssignments(
        { db: tx },
        { userId: c.users.owner, workspaceId: c.workspaceId },
        { date: DAY },
      );
      const s = out.suggestions.find((x) => x.listingId === listingId);
      // Only the listed owner can see it, so only the owner is proposed.
      expect(s?.memberId).toBe(c.members.owner);
      const open = await c.listed({ itemNo: '9' });
      const out2 = await suggestAssignments(
        { db: tx },
        { userId: c.users.owner, workspaceId: c.workspaceId },
        { date: DAY },
      );
      expect(out2.suggestions.find((x) => x.listingId === open.listingId)?.kind).toBe('unassigned');
    });
  });

  it('refuses a junior', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      await expect(
        suggestAssignments(
          { db: tx },
          { userId: c.users.junior, workspaceId: c.workspaceId },
          { date: DAY },
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
