import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { assignAppearance } from '../assign.ts';
import { getCourtDay } from '../../court-day/index.ts';
import { chamberOutcomesLive, myAppearances } from '../view.ts';

import { DAY, seedChamber } from './helpers.ts';

describe('Mine scope and delegated reads (R2, R5, R6)', () => {
  it('shows a junior only their assigned appearances in myAppearances and the Mine court day', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const mine = await c.listed({ itemNo: '1' });
      const other = await c.listed({ itemNo: '2' });
      await c.listed({ itemNo: '3' });
      const owner = { userId: c.users.owner, workspaceId: c.workspaceId };
      await assignAppearance({ db: tx }, owner, {
        listingId: mine.listingId,
        memberId: c.members.junior,
        capacity: 'arguing',
        note: 'strategy note',
      });
      await assignAppearance({ db: tx }, owner, {
        listingId: other.listingId,
        memberId: c.members.advocate,
        capacity: 'arguing',
      });
      const junior = { userId: c.users.junior, workspaceId: c.workspaceId };
      const view = await myAppearances({ db: tx }, junior, { date: DAY });
      expect(view.appearances.map((a) => a.listingId)).toEqual([mine.listingId]);
      const day = await getCourtDay({ db: tx }, junior, { date: DAY, scope: 'mine' });
      const ids = day.complexes.flatMap((x) =>
        x.halls.flatMap((h) => h.lists.flatMap((l) => l.items.map((i) => i.listingId))),
      );
      expect(ids).toEqual([mine.listingId]);
    });
  });

  it('hides a restricted matter from a junior who is not listed, and notes from a clerk', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const owner = { userId: c.users.owner, workspaceId: c.workspaceId };
      const open = await c.listed({ itemNo: '1' });
      await assignAppearance({ db: tx }, owner, {
        listingId: open.listingId,
        memberId: c.members.clerk,
        capacity: 'assisting',
        note: 'secret plan',
      });
      const clerk = await myAppearances(
        { db: tx },
        { userId: c.users.clerk, workspaceId: c.workspaceId },
        { date: DAY },
      );
      expect(clerk.appearances).toHaveLength(1);
      expect(JSON.stringify(clerk)).not.toContain('secret plan');
      const asOwner = await myAppearances({ db: tx }, owner, { date: DAY });
      expect(asOwner.appearances).toHaveLength(0);
    });
  });

  it('chamberOutcomesLive needs court_day.view_all and counts the delegated items', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const owner = { userId: c.users.owner, workspaceId: c.workspaceId };
      const { listingId } = await c.listed();
      await assignAppearance({ db: tx }, owner, {
        listingId,
        memberId: c.members.junior,
        capacity: 'arguing',
      });
      const live = await chamberOutcomesLive({ db: tx }, owner, { date: DAY });
      expect(live.members.find((m) => m.memberId === c.members.junior)).toMatchObject({
        total: 1,
        outcomesIn: 0,
      });
      await expect(
        chamberOutcomesLive(
          { db: tx },
          { userId: c.users.junior, workspaceId: c.workspaceId },
          { date: DAY },
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
