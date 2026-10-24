import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildCourtHall, buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { addMember, newWorkspace } from '../__tests__/fixtures.ts';
import { WorkspaceError } from '../shared/errors.ts';

import { clearCurrentItem, setCurrentItem } from './markers.ts';

async function seed(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const hall = await inWorkspace(tx, workspaceId, async (s) => {
    const forum = await buildForum(s, workspaceId);
    return buildCourtHall(s, workspaceId, { forumId: forum.id });
  });
  return { ownerId, workspaceId, hallId: hall.id };
}

describe('setCurrentItem (R8)', () => {
  it('stores the marker with the setter and time, audits it and changes no listing', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId, hallId } = await seed(tx);
      const actor = { userId: ownerId, workspaceId };
      const listingsBefore = await inWorkspace(tx, workspaceId, (s) => s.select().from(schema.listing));
      const row = await setCurrentItem({ db: tx }, actor, {
        hallId,
        listDate: '2026-11-02',
        currentItem: 14,
        note: 'lunch at 13',
      });
      expect(row).toMatchObject({ hallId, currentItem: 14, setBy: ownerId, note: 'lunch at 13' });
      expect(row.setAt).toBeInstanceOf(Date);

      const moved = await setCurrentItem({ db: tx }, actor, { hallId, listDate: '2026-11-02', currentItem: 20 });
      expect(moved.id).toBe(row.id);
      expect(moved.currentItem).toBe(20);

      const events = await inWorkspace(tx, workspaceId, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.workspaceId, workspaceId),
              eq(schema.auditEvent.action, 'court_day.marker_set'),
            ),
          ),
      );
      expect(events).toHaveLength(2);
      expect(JSON.stringify(events.map((e) => e.metadata))).not.toContain('lunch');
      expect(await inWorkspace(tx, workspaceId, (s) => s.select().from(schema.listing))).toEqual(
        listingsBefore,
      );
    });
  });

  it('refuses a viewer, an unknown hall and a malformed marker', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, hallId } = await seed(tx);
      const viewer = await addMember(tx, workspaceId, 'viewer');
      const actor = { userId: viewer, workspaceId };
      await expect(
        setCurrentItem({ db: tx }, actor, { hallId, listDate: '2026-11-02', currentItem: 3 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const owner = await inWorkspace(tx, workspaceId, (s) => s.select().from(schema.member));
      const ownerUser = owner.find((m) => m.role === 'owner')?.userId ?? '';
      const asOwner = { userId: ownerUser, workspaceId };
      await expect(
        setCurrentItem({ db: tx }, asOwner, {
          hallId: '00000000-0000-4000-8000-000000000000',
          listDate: '2026-11-02',
          currentItem: 3,
        }),
      ).rejects.toBeInstanceOf(WorkspaceError);
      await expect(
        setCurrentItem({ db: tx }, asOwner, { hallId, listDate: '2026-11-02', currentItem: 0 }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });
});

describe('clearCurrentItem', () => {
  it('removes the marker, audits it and reports whether one existed', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId, hallId } = await seed(tx);
      const actor = { userId: ownerId, workspaceId };
      const input = { hallId, listDate: '2026-11-02' };
      expect(await clearCurrentItem({ db: tx }, actor, input)).toBe(false);
      await setCurrentItem({ db: tx }, actor, { ...input, currentItem: 5 });
      expect(await clearCurrentItem({ db: tx }, actor, input)).toBe(true);
      const left = await inWorkspace(tx, workspaceId, (s) => s.select().from(schema.courtDayMarker));
      expect(left).toEqual([]);
      const cleared = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'court_day.marker_cleared')),
      );
      expect(cleared).toHaveLength(1);
    });
  });
});
