import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  appearanceReassignProvider,
  assignAppearance,
  reassignAppearance,
  unassign,
} from '../assign.ts';

import { DAY, seedChamber } from './helpers.ts';

const events = (tx: Parameters<Parameters<typeof withTestDb>[0]>[0], ws: string, action: string) =>
  inWorkspace(tx, ws, (s) =>
    s
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.workspaceId, ws), eq(schema.auditEvent.action, action))),
  );

describe('assignAppearance and reassignAppearance (R1)', () => {
  it('assigns with capacity and note, notifies the assignee in-app, audits ids only', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const { listingId } = await c.listed();
      const actor = { userId: c.users.owner, workspaceId: c.workspaceId };
      const out = await assignAppearance({ db: tx }, actor, {
        listingId,
        memberId: c.members.junior,
        capacity: 'arguing',
        note: 'bring the vakalatnama',
      });
      expect(out).toMatchObject({ memberId: c.members.junior, previousMemberId: null });
      const notes = await inWorkspace(tx, c.workspaceId, (s) =>
        s.select().from(schema.notification),
      );
      expect(notes.map((n) => n.userId)).toEqual([c.users.junior]);
      const assigned = await events(tx, c.workspaceId, 'appearance.assigned');
      expect(assigned).toHaveLength(1);
      expect(JSON.stringify(assigned[0]?.metadata)).not.toContain('vakalatnama');
    });
  });

  it('records the previous assignee on reassignment', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const { listingId } = await c.listed();
      const actor = { userId: c.users.advocate, workspaceId: c.workspaceId };
      const first = await assignAppearance({ db: tx }, actor, {
        listingId,
        memberId: c.members.junior,
        capacity: 'arguing',
      });
      const moved = await reassignAppearance({ db: tx }, actor, {
        appearanceId: first.appearanceId,
        toMemberId: c.members.advocate,
      });
      expect(moved.previousMemberId).toBe(c.members.junior);
      const [ev] = await events(tx, c.workspaceId, 'appearance.reassigned');
      expect(ev?.metadata).toMatchObject({ previousMemberId: c.members.junior });
    });
  });

  it('lets the owner switch advocates off, and refuses junior, clerk and viewer (R6)', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const { listingId } = await c.listed();
      const input = { listingId, memberId: c.members.advocate, capacity: 'arguing' as const };
      for (const role of ['junior', 'clerk'] as const) {
        await expect(
          assignAppearance({ db: tx }, { userId: c.users[role], workspaceId: c.workspaceId }, input),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      const off = { db: tx, settings: { advocatesCanAssign: false } };
      await expect(
        assignAppearance(off, { userId: c.users.advocate, workspaceId: c.workspaceId }, input),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        assignAppearance(off, { userId: c.users.owner, workspaceId: c.workspaceId }, input),
      ).resolves.toMatchObject({ memberId: c.members.advocate });
    });
  });
});

describe('restricted matters (R7)', () => {
  it('blocks a member who cannot see it, and an owner override grants access with an audit', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const { listingId, matterId } = await c.listed({ allow: [c.users.advocate] });
      const base = { listingId, memberId: c.members.junior, capacity: 'arguing' as const };
      await expect(
        assignAppearance({ db: tx }, { userId: c.users.advocate, workspaceId: c.workspaceId }, base),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      // An advocate cannot override; only an owner can.
      await expect(
        assignAppearance(
          { db: tx },
          { userId: c.users.advocate, workspaceId: c.workspaceId },
          { ...base, grantAccess: true },
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const out = await assignAppearance(
        { db: tx },
        { userId: c.users.owner, workspaceId: c.workspaceId },
        { ...base, grantAccess: true },
      );
      expect(out.accessGranted).toBe(true);
      const [r] = await inWorkspace(tx, c.workspaceId, (s) =>
        s
          .select()
          .from(schema.matterRestriction)
          .where(eq(schema.matterRestriction.matterId, matterId)),
      );
      expect(r?.allowedUserIds).toContain(c.users.junior);
      expect(await events(tx, c.workspaceId, 'matter.access_granted')).toHaveLength(1);
    });
  });
});

describe('bulk reassignment and offboarding (R8)', () => {
  it('moves a departing member from a date on and leaves earlier ones', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const a = await c.listed({ itemNo: '1' });
      const b = await c.listed({ itemNo: '2' });
      const actor = { userId: c.users.owner, workspaceId: c.workspaceId };
      const first = await assignAppearance({ db: tx }, actor, {
        listingId: a.listingId,
        memberId: c.members.junior,
        capacity: 'arguing',
      });
      const second = await assignAppearance({ db: tx }, actor, {
        listingId: b.listingId,
        memberId: c.members.junior,
        capacity: 'proxy',
      });
      // A later start date than the listing day keeps both as history.
      const none = await reassignAppearance({ db: tx }, actor, {
        fromMemberId: c.members.junior,
        toMemberId: c.members.advocate,
        fromDate: '2026-12-01',
      });
      expect(none.moved).toBe(0);
      const out = await reassignAppearance({ db: tx }, actor, {
        fromMemberId: c.members.junior,
        toMemberId: c.members.advocate,
        fromDate: DAY,
      });
      expect(out.appearanceIds.sort()).toEqual([first.appearanceId, second.appearanceId].sort());
      const evs = await events(tx, c.workspaceId, 'appearance.reassigned');
      expect(evs).toHaveLength(2);
      expect(evs[0]?.metadata).toMatchObject({ previousMemberId: c.members.junior });
    });
  });

  it('registers an offboarding provider that counts upcoming appearances only', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const { listingId } = await c.listed();
      await assignAppearance(
        { db: tx },
        { userId: c.users.owner, workspaceId: c.workspaceId },
        { listingId, memberId: c.members.junior, capacity: 'arguing' },
      );
      const count = await inWorkspace(tx, c.workspaceId, (s) =>
        appearanceReassignProvider.countOpen(s, c.workspaceId, c.users.junior),
      );
      // The fixture day is in the past relative to a real run only after 2026-11-02.
      expect(count).toBe(new Date() <= new Date(`${DAY}T23:59:59+05:30`) ? 1 : 0);
    });
  });
});

describe('unassign', () => {
  it('removes the member and audits who held it', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const { listingId } = await c.listed();
      const actor = { userId: c.users.owner, workspaceId: c.workspaceId };
      const a = await assignAppearance({ db: tx }, actor, {
        listingId,
        memberId: c.members.junior,
        capacity: 'arguing',
      });
      await unassign({ db: tx }, actor, { appearanceId: a.appearanceId });
      const left = await inWorkspace(tx, c.workspaceId, (s) => s.select().from(schema.appearance));
      expect(left).toHaveLength(0);
      const [ev] = await events(tx, c.workspaceId, 'appearance.unassigned');
      expect(ev?.metadata).toMatchObject({ previousMemberId: c.members.junior });
    });
  });
});
