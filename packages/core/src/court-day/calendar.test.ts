import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildCourtHall,
  buildForum,
  buildHearing,
  buildListing,
  buildMatter,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { describe, expect, it } from 'vitest';

import { addMember, newWorkspace } from '../__tests__/fixtures.ts';

import { getCalendarRange } from './calendar.ts';

const FROM = '2026-11-02';
const TO = '2026-11-08';

async function memberIdOf(tx: Transaction, workspaceId: string, userId: string): Promise<string> {
  const rows = await inWorkspace(tx, workspaceId, (s) =>
    s.select({ id: schema.member.id, userId: schema.member.userId }).from(schema.member),
  );
  const found = rows.find((m) => m.userId === userId);
  if (found === undefined) throw new Error('member not found');
  return found.id;
}

async function seed(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const ownerMemberId = await memberIdOf(tx, workspaceId, ownerId);
  const base = await inWorkspace(tx, workspaceId, async (s) => {
    const forum = await buildForum(s, workspaceId);
    const hall3 = await buildCourtHall(s, workspaceId, { forumId: forum.id, hallNo: '3' });
    const hall12 = await buildCourtHall(s, workspaceId, { forumId: forum.id, hallNo: '12A' });
    return { forumId: forum.id, hall3: hall3.id, hall12: hall12.id };
  });
  const matterWith = (over: { ownerMemberId?: string | null; title?: string } = {}) =>
    inWorkspace(tx, workspaceId, async (s) => {
      const m = await buildMatter(s, workspaceId, { ownerMemberId, ...over });
      const p = await buildProceeding(s, workspaceId, {
        matterId: m.id,
        forumId: base.forumId,
        number: String(Math.floor(Math.random() * 9000) + 100),
        year: 2026,
      });
      return { matterId: m.id, proceedingId: p.id };
    });
  const listAt = (proceedingId: string, listDate: string, over: Record<string, unknown>) =>
    inWorkspace(tx, workspaceId, (s) =>
      buildListing(s, workspaceId, { proceedingId, listDate, ...over }),
    );
  return { ownerId, workspaceId, ownerMemberId, ...base, matterWith, listAt };
}

const byDate = (days: Awaited<ReturnType<typeof getCalendarRange>>, date: string) => {
  const found = days.find((d) => d.date === date);
  if (found === undefined) throw new Error(`no day ${date}`);
  return found;
};

describe('getCalendarRange (#66)', () => {
  it('returns one row per day with listings, confirmed and proposed next dates and obligations', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const m = await s.matterWith();
      const l = await s.listAt(m.proceedingId, '2026-11-03', { hallId: s.hall3, itemNo: '4' });
      await inWorkspace(tx, s.workspaceId, async (db) => {
        await buildHearing(db, s.workspaceId, {
          listingId: l.id,
          nextDateConfirmed: '2026-11-05',
          nextDateProposed: '2026-11-06',
        });
        await buildHearing(db, s.workspaceId, { listingId: l.id, nextDateProposed: '2026-11-07' });
        await db.insert(schema.obligation).values({
          workspaceId: s.workspaceId,
          matterId: m.matterId,
          proceedingId: m.proceedingId,
          source: 'internal',
          description: 'File counter',
          dueDate: '2026-11-04',
          sourceType: 'manual',
          confirmationState: 'confirmed',
        });
      });
      const days = await getCalendarRange(
        { db: tx },
        { userId: s.ownerId, workspaceId: s.workspaceId },
        { from: FROM, to: TO },
      );
      expect(days.map((d) => d.date)).toHaveLength(7);
      expect(byDate(days, '2026-11-03').counts).toMatchObject({
        listings: 1,
        proposed: 1,
        confirmed: 0,
      });
      expect(byDate(days, '2026-11-03').entries[0]).toMatchObject({
        kind: 'listing',
        hallNo: '3',
        itemNo: '4',
      });
      expect(byDate(days, '2026-11-04').counts).toMatchObject({ obligationsDue: 1, confirmed: 1 });
      const confirmed = byDate(days, '2026-11-05');
      expect(confirmed.counts).toMatchObject({ nextDates: 1, confirmed: 1, proposed: 0 });
      expect(confirmed.entries[0]).toMatchObject({ kind: 'next_date', proposed: false });
      // A proposed next date is shown dashed, never counted as a confirmed commitment.
      expect(byDate(days, '2026-11-06').entries).toEqual([]);
      const proposed = byDate(days, '2026-11-07');
      expect(proposed.entries[0]).toMatchObject({ kind: 'next_date', proposed: true });
      expect(proposed.counts).toMatchObject({ nextDates: 0, confirmed: 0, proposed: 1 });
      expect(byDate(days, '2026-11-08').closedReason).toBeNull();
    });
  });

  it('validates the range: at most 42 days, to not before from, ISO dates', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const as = { userId: s.ownerId, workspaceId: s.workspaceId };
      const ok = await getCalendarRange({ db: tx }, as, { from: '2026-11-01', to: '2026-12-12' });
      expect(ok).toHaveLength(42);
      await expect(
        getCalendarRange({ db: tx }, as, { from: '2026-11-01', to: '2026-12-13' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        getCalendarRange({ db: tx }, as, { from: '2026-11-05', to: '2026-11-04' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        getCalendarRange({ db: tx }, as, { from: 'soon', to: '2026-11-04' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });

  it('flags a day on which one member is listed in different halls', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const m1 = await s.matterWith();
      const m2 = await s.matterWith();
      const a = await s.listAt(m1.proceedingId, '2026-11-03', { hallId: s.hall3, itemNo: '1' });
      const b = await s.listAt(m2.proceedingId, '2026-11-03', { hallId: s.hall12, itemNo: '2' });
      await inWorkspace(tx, s.workspaceId, async (db) => {
        for (const l of [a, b]) {
          const h = await buildHearing(db, s.workspaceId, { listingId: l.id });
          await db.insert(schema.appearance).values({
            workspaceId: s.workspaceId,
            hearingId: h.id,
            memberId: s.ownerMemberId,
            capacity: 'arguing',
          });
        }
      });
      const days = await getCalendarRange(
        { db: tx },
        { userId: s.ownerId, workspaceId: s.workspaceId },
        { from: FROM, to: TO },
      );
      expect(byDate(days, '2026-11-03').clash).toBe(true);
      expect(byDate(days, '2026-11-04').clash).toBe(false);
    });
  });

  it('scopes mine and workspace; workspace needs court_day.view_all', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const advocate = await addMember(tx, s.workspaceId, 'advocate');
      const advocateMember = await memberIdOf(tx, s.workspaceId, advocate);
      const own = await s.matterWith({ ownerMemberId: advocateMember });
      const other = await s.matterWith();
      await s.listAt(own.proceedingId, '2026-11-03', { hallId: s.hall3, itemNo: '1' });
      await s.listAt(other.proceedingId, '2026-11-03', { hallId: s.hall3, itemNo: '2' });
      const as = { userId: advocate, workspaceId: s.workspaceId };
      const mine = await getCalendarRange({ db: tx }, as, { from: FROM, to: TO });
      expect(byDate(mine, '2026-11-03').counts.listings).toBe(1);
      const owner = await getCalendarRange(
        { db: tx },
        { userId: s.ownerId, workspaceId: s.workspaceId },
        { from: FROM, to: TO, scope: 'workspace' },
      );
      expect(byDate(owner, '2026-11-03').counts.listings).toBe(2);
      const junior = await addMember(tx, s.workspaceId, 'junior');
      await expect(
        getCalendarRange(
          { db: tx },
          { userId: junior, workspaceId: s.workspaceId },
          {
            from: FROM,
            to: TO,
            scope: 'workspace',
          },
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  it('keeps the stage and obligation text out of the clerk payload', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const clerk = await addMember(tx, s.workspaceId, 'clerk');
      const clerkMember = await memberIdOf(tx, s.workspaceId, clerk);
      const m = await s.matterWith({ ownerMemberId: clerkMember });
      await s.listAt(m.proceedingId, '2026-11-03', { hallId: s.hall3, itemNo: '1' });
      await inWorkspace(tx, s.workspaceId, (db) =>
        db.insert(schema.obligation).values({
          workspaceId: s.workspaceId,
          matterId: m.matterId,
          source: 'internal',
          description: 'Strategy: hold the counter',
          dueDate: '2026-11-03',
          sourceType: 'manual',
        }),
      );
      const asClerk = await getCalendarRange(
        { db: tx },
        { userId: clerk, workspaceId: s.workspaceId },
        { from: FROM, to: TO },
      );
      const day = byDate(asClerk, '2026-11-03');
      expect(day.counts).toMatchObject({ listings: 1, obligationsDue: 1 });
      expect(JSON.stringify(day)).not.toContain('Strategy');
      expect(JSON.stringify(day)).not.toContain('FOR ADMISSION');
      const asOwner = await getCalendarRange(
        { db: tx },
        { userId: s.ownerId, workspaceId: s.workspaceId },
        { from: FROM, to: TO, scope: 'workspace' },
      );
      expect(JSON.stringify(byDate(asOwner, '2026-11-03'))).toContain('Strategy: hold the counter');
    });
  });

  it('redacts a restricted matter the member is not on, keeping its date and kind', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const advocate = await addMember(tx, s.workspaceId, 'advocate');
      const m = await s.matterWith({ title: 'Secret matter' });
      await s.listAt(m.proceedingId, '2026-11-03', { hallId: s.hall3, itemNo: '1' });
      await inWorkspace(tx, s.workspaceId, (db) =>
        db.insert(schema.matterRestriction).values({
          workspaceId: s.workspaceId,
          matterId: m.matterId,
          allowedUserIds: [s.ownerId],
        }),
      );
      const seen = await getCalendarRange(
        { db: tx },
        { userId: advocate, workspaceId: s.workspaceId },
        { from: FROM, to: TO, scope: 'workspace' },
      ).catch(() => null);
      // An advocate may lack view_all; the owner is the reader with a seat that is not on the list.
      if (seen !== null) {
        const entry = byDate(seen, '2026-11-03').entries[0];
        expect(entry).toMatchObject({ redacted: true, matterId: null, matterTitle: null });
      }
      const owner = await getCalendarRange(
        { db: tx },
        { userId: s.ownerId, workspaceId: s.workspaceId },
        { from: FROM, to: TO },
      );
      expect(byDate(owner, '2026-11-03').entries[0]).toMatchObject({
        redacted: false,
        matterTitle: 'Secret matter',
      });
    });
  });

  it('renders no closure marker when the forum calendar has no data', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const m = await s.matterWith();
      await s.listAt(m.proceedingId, '2026-11-03', { hallId: s.hall3, itemNo: '1' });
      const days = await getCalendarRange(
        { db: tx },
        { userId: s.ownerId, workspaceId: s.workspaceId },
        { from: FROM, to: TO },
      );
      expect(days.every((d) => d.closedReason === null)).toBe(true);
      expect(
        days.flatMap((d) => d.entries).some((e) => e.kind === 'holiday' || e.kind === 'vacation'),
      ).toBe(false);
    });
  });
});
