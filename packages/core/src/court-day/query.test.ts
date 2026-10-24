import { performance } from 'node:perf_hooks';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildBench,
  buildCourtHall,
  buildForum,
  buildListing,
  buildMatter,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { insertCourtDayFixture } from '@causedeck/db/seed/court-day-fixtures';
import { describe, expect, it } from 'vitest';

import { addMember, newWorkspace } from '../__tests__/fixtures.ts';

import { getCourtDay } from './query.ts';

const DAY = '2026-11-02';

async function memberIdOf(tx: Transaction, workspaceId: string, userId: string): Promise<string> {
  const rows = await inWorkspace(tx, workspaceId, (s) =>
    s.select({ id: schema.member.id, userId: schema.member.userId }).from(schema.member),
  );
  const found = rows.find((m) => m.userId === userId);
  if (found === undefined) throw new Error('member not found');
  return found.id;
}

/** A workspace with one forum, two halls and a bench; matters are the owner's unless overridden. */
async function seed(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const ownerMemberId = await memberIdOf(tx, workspaceId, ownerId);
  const base = await inWorkspace(tx, workspaceId, async (s) => {
    const forum = await buildForum(s, workspaceId);
    const hall3 = await buildCourtHall(s, workspaceId, { forumId: forum.id, hallNo: '3' });
    const hall12 = await buildCourtHall(s, workspaceId, { forumId: forum.id, hallNo: '12A' });
    const bench = await buildBench(s, workspaceId, { forumId: forum.id });
    return { forumId: forum.id, hall3: hall3.id, hall12: hall12.id, benchId: bench.id };
  });
  const matterWith = async (
    over: { ownerMemberId?: string | null; sensitive?: boolean; synopsis?: string; title?: string },
    listings: Record<string, unknown>[],
  ) =>
    inWorkspace(tx, workspaceId, async (s) => {
      const m = await buildMatter(s, workspaceId, { ownerMemberId, ...over });
      const p = await buildProceeding(s, workspaceId, {
        matterId: m.id,
        forumId: base.forumId,
        number: String(Math.floor(Math.random() * 9000) + 100),
        year: 2026,
      });
      const made = [];
      for (const l of listings) {
        made.push(await buildListing(s, workspaceId, { proceedingId: p.id, listDate: DAY, ...l }));
      }
      return { matterId: m.id, proceedingId: p.id, listings: made };
    });
  return { ownerId, workspaceId, ownerMemberId, ...base, matterWith };
}

const itemNos = (day: Awaited<ReturnType<typeof getCourtDay>>) =>
  day.complexes.flatMap((c) =>
    c.halls.flatMap((h) => h.lists.flatMap((l) => l.items.map((i) => `${h.hallNo}/${l.listType}/${i.itemNo}`))),
  );

describe('getCourtDay grouping and order (R1, R3)', () => {
  it('groups complex, hall, list type and item, numerically, supplementary after daily', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      await s.matterWith({}, [
        { hallId: s.hall3, itemNo: '10', benchId: s.benchId },
        { hallId: s.hall3, itemNo: '9' },
        { hallId: s.hall3, itemNo: '2', listType: 'supplementary' },
      ]);
      await s.matterWith({}, [
        { hallId: s.hall3, itemNo: '9', listNo: 2 },
        { hallId: s.hall3, itemNo: '9', listNo: 1 },
        { hallId: s.hall12, itemNo: '1' },
      ]);
      const day = await getCourtDay({ db: tx }, { userId: s.ownerId, workspaceId: s.workspaceId }, { date: DAY });
      expect(day.complexes).toHaveLength(1);
      expect(day.complexes[0]?.halls.map((h) => h.hallNo)).toEqual(['3', '12A']);
      expect(itemNos(day)).toEqual([
        '3/daily/9',
        '3/daily/9',
        '3/daily/9',
        '3/daily/10',
        '3/supplementary/2',
        '12A/daily/1',
      ]);
      const hall3 = day.complexes[0]?.halls[0];
      const nines = hall3?.lists[0]?.items.filter((i) => i.itemNo === '9') ?? [];
      expect(nines.map((i) => i.listNo)).toEqual([null, 1, 2]);
      const first = hall3?.lists[0]?.items[0];
      expect(first).toMatchObject({
        stageRaw: 'FOR ADMISSION',
        sourceType: 'manual',
        confirmationState: 'proposed',
        openObligations: 0,
        carryCount: 0,
        assigneeMemberId: s.ownerMemberId,
      });
      expect(first?.caseLabel).toMatch(/^WP \d+\/2026$/);
      const withBench = hall3?.lists[0]?.items.find((i) => i.itemNo === '10');
      expect(withBench?.bench.length).toBeGreaterThan(0);
      expect(day.freshness).toBeInstanceOf(Date);
    });
  });

  it('counts open obligations and earlier listings (carry)', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const m = await s.matterWith({}, [
        { hallId: s.hall3, itemNo: '1' },
        { listDate: '2026-10-01', itemNo: '4', hallId: s.hall3 },
        { listDate: '2026-10-15', itemNo: '4', hallId: s.hall3 },
      ]);
      await inWorkspace(tx, s.workspaceId, (db) =>
        db.insert(schema.obligation).values({
          workspaceId: s.workspaceId,
          matterId: m.matterId,
          proceedingId: m.proceedingId,
          source: 'manual',
          description: 'File counter',
          sourceType: 'manual',
        }),
      );
      const day = await getCourtDay({ db: tx }, { userId: s.ownerId, workspaceId: s.workspaceId }, { date: DAY });
      const item = day.complexes[0]?.halls[0]?.lists[0]?.items[0];
      expect(item).toMatchObject({ openObligations: 1, carryCount: 2 });
    });
  });
});

describe('getCourtDay scopes (R2)', () => {
  it('mine returns the caller\'s matters and appearances; workspace needs court_day.view_all', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const advocate = await addMember(tx, s.workspaceId, 'advocate');
      const advocateMember = await memberIdOf(tx, s.workspaceId, advocate);
      await s.matterWith({ title: 'Owner matter' }, [{ hallId: s.hall3, itemNo: '1' }]);
      await s.matterWith({ title: 'Advocate matter', ownerMemberId: advocateMember }, [
        { hallId: s.hall3, itemNo: '2' },
      ]);
      const appeared = await s.matterWith({ title: 'Appearance only' }, [{ hallId: s.hall12, itemNo: '3' }]);
      await inWorkspace(tx, s.workspaceId, async (db) => {
        const [h] = await db
          .insert(schema.hearing)
          .values({
            workspaceId: s.workspaceId,
            listingId: appeared.listings[0]?.id ?? '',
            heldOn: DAY,
            sourceType: 'manual',
          })
          .returning({ id: schema.hearing.id });
        await db.insert(schema.appearance).values({
          workspaceId: s.workspaceId,
          hearingId: h?.id ?? '',
          memberId: advocateMember,
          capacity: 'arguing',
        });
      });
      const asAdvocate = { userId: advocate, workspaceId: s.workspaceId };
      const titles = async (scope: 'mine' | 'workspace', who = asAdvocate, settings = {}) =>
        (await getCourtDay({ db: tx, settings }, who, { date: DAY, scope }))
          .complexes.flatMap((c) => c.halls.flatMap((h) => h.lists.flatMap((l) => l.items)))
          .map((i) => i.matterTitle)
          .sort();
      expect(await titles('mine')).toEqual(['Advocate matter', 'Appearance only']);
      expect(await titles('workspace')).toHaveLength(3);
      const mineDay = await getCourtDay({ db: tx }, asAdvocate, { date: DAY });
      expect(mineDay.scope).toBe('mine');
      const arguing = mineDay.complexes[0]?.halls.flatMap((h) => h.lists.flatMap((l) => l.items)).find(
        (i) => i.matterTitle === 'Appearance only',
      );
      expect(arguing?.capacity).toBe('arguing');
      expect(arguing?.appearingMemberIds).toEqual([advocateMember]);

      // The owner turned the advocate's workspace view off: scope workspace is refused, mine is not.
      const off = { advocatesCanViewAllCourtDay: false };
      await expect(titles('workspace', asAdvocate, off)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await titles('mine', asAdvocate, off)).toHaveLength(2);
      expect(await titles('workspace', { userId: s.ownerId, workspaceId: s.workspaceId }, off)).toHaveLength(3);
      const junior = await addMember(tx, s.workspaceId, 'junior');
      await expect(
        getCourtDay({ db: tx }, { userId: junior, workspaceId: s.workspaceId }, { date: DAY, scope: 'workspace' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  it('refuses a stranger and a malformed query', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const stranger = (await newWorkspace(tx)).ownerId;
      await expect(
        getCourtDay({ db: tx }, { userId: stranger, workspaceId: s.workspaceId }, { date: DAY }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        getCourtDay({ db: tx }, { userId: s.ownerId, workspaceId: s.workspaceId }, { date: 'tomorrow' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });
});

describe('getCourtDay expected but not listed (R11)', () => {
  it('returns a proceeding whose confirmed date is the day but that no list placed', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const missing = await s.matterWith({ title: 'Missing from list' }, [
        { canonical: true, confirmationState: 'confirmed' },
      ]);
      await s.matterWith({ title: 'Listed' }, [
        { canonical: true, confirmationState: 'confirmed', hallId: s.hall3, itemNo: '5' },
      ]);
      await s.matterWith({ title: 'Only proposed' }, [{ canonical: false }]);
      const day = await getCourtDay({ db: tx }, { userId: s.ownerId, workspaceId: s.workspaceId }, { date: DAY });
      expect(day.expectedNotListed.map((e) => e.proceedingId)).toEqual([missing.proceedingId]);
      expect(day.expectedNotListed[0]?.matterTitle).toBe('Missing from list');
      expect(itemNos(day)).toEqual(['3/daily/5']);
    });
  });
});

describe('getCourtDay role and sensitive payloads (R12, R14)', () => {
  it('keeps the marker note and matter memory out of the clerk payload', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      await s.matterWith({ synopsis: 'Settle if costs are waived' }, [{ hallId: s.hall3, itemNo: '1' }]);
      await inWorkspace(tx, s.workspaceId, (db) =>
        db.insert(schema.courtDayMarker).values({
          workspaceId: s.workspaceId,
          hallId: s.hall3,
          listDate: DAY,
          currentItem: 4,
          setBy: s.ownerId,
          note: 'senior is late',
        }),
      );
      const clerk = await addMember(tx, s.workspaceId, 'clerk');
      const asClerk = await getCourtDay(
        { db: tx },
        { userId: clerk, workspaceId: s.workspaceId },
        { date: DAY, scope: 'workspace' },
      ).catch((e: unknown) => e);
      // A clerk reads the court day through `mine` only when it has items; the workspace view is
      // advocate and above, so the clerk payload is checked on `mine` with an owned matter below.
      expect(asClerk).toMatchObject({ code: 'FORBIDDEN' });
      const clerkMember = await memberIdOf(tx, s.workspaceId, clerk);
      await s.matterWith({ ownerMemberId: clerkMember, synopsis: 'Strategy text' }, [
        { hallId: s.hall3, itemNo: '2' },
      ]);
      const mine = await getCourtDay({ db: tx }, { userId: clerk, workspaceId: s.workspaceId }, { date: DAY });
      const json = JSON.stringify(mine);
      expect(mine.complexes[0]?.halls[0]?.marker).toMatchObject({ currentItem: 4 });
      expect(json).not.toContain('senior is late');
      expect(json).not.toContain('Strategy text');
      expect(json).not.toContain('matterMemory');
      expect(mine.complexes[0]?.halls[0]?.marker).not.toHaveProperty('note');

      const owner = await getCourtDay({ db: tx }, { userId: s.ownerId, workspaceId: s.workspaceId }, { date: DAY });
      expect(owner.complexes[0]?.halls[0]?.marker?.note).toBe('senior is late');
      expect(JSON.stringify(owner)).toContain('Settle if costs are waived');
    });
  });

  it('lists a sensitive matter without any AI-derived field', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      await s.matterWith({ sensitive: true, synopsis: 'AI summary' }, [
        { hallId: s.hall3, itemNo: '1', stageNorm: 'admission', confidence: '0.900', sourceType: 'ai', sourceRef: 'x', confirmationState: 'proposed' },
      ]);
      await s.matterWith({ synopsis: 'Plain' }, [
        { hallId: s.hall3, itemNo: '2', stageNorm: 'admission', confidence: '0.900', sourceType: 'ai', sourceRef: 'x' },
      ]);
      const day = await getCourtDay({ db: tx }, { userId: s.ownerId, workspaceId: s.workspaceId }, { date: DAY });
      const items = day.complexes[0]?.halls[0]?.lists[0]?.items ?? [];
      const sensitive = items.find((i) => i.itemNo === '1');
      const normal = items.find((i) => i.itemNo === '2');
      expect(sensitive?.sensitive).toBe(true);
      expect(sensitive).not.toHaveProperty('stageNorm');
      expect(sensitive).not.toHaveProperty('confidence');
      expect(sensitive).not.toHaveProperty('matterMemory');
      expect(normal).toMatchObject({ stageNorm: 'admission', matterMemory: 'Plain' });
    });
  });

  it('hides a restricted matter from a member who is not on its list', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const advocate = await addMember(tx, s.workspaceId, 'advocate');
      const m = await s.matterWith({}, [{ hallId: s.hall3, itemNo: '1' }]);
      await inWorkspace(tx, s.workspaceId, (db) =>
        db.insert(schema.matterRestriction).values({
          workspaceId: s.workspaceId,
          matterId: m.matterId,
          allowedUserIds: [s.ownerId],
        }),
      );
      const asAdvocate = { userId: advocate, workspaceId: s.workspaceId };
      const seen = await getCourtDay({ db: tx }, asAdvocate, { date: DAY, scope: 'workspace' });
      expect(seen.complexes).toEqual([]);
      const owner = await getCourtDay({ db: tx }, { userId: s.ownerId, workspaceId: s.workspaceId }, { date: DAY });
      expect(owner.complexes).toHaveLength(1);
    });
  });
});

describe('getCourtDay budget on the seeded chamber (R13)', () => {
  it('issues at most 6 statements and answers in under 150 ms (p95)', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const ownerMemberId = await memberIdOf(tx, workspaceId, ownerId);
      const fixture = await inWorkspace(tx, workspaceId, (s) =>
        insertCourtDayFixture(s, { workspaceId, ownerMemberId, date: DAY }),
      );
      expect(fixture.listingIds).toHaveLength(40);

      let statements = 0;
      const counted = (inner: object): object =>
        new Proxy(inner, {
          get(target, prop, receiver) {
            const value: unknown = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function') return value;
            if (prop === 'transaction') {
              return (cb: (t: object) => unknown, cfg?: unknown) =>
                (value as (...a: unknown[]) => unknown).call(target, (t: object) => cb(counted(t)), cfg);
            }
            if (['select', 'insert', 'update', 'delete', 'execute'].includes(String(prop))) {
              return (...args: unknown[]) => {
                statements++;
                return (value as (...a: unknown[]) => unknown).apply(target, args);
              };
            }
            return value.bind(target);
          },
        });
      const actor = { userId: ownerId, workspaceId };
      const day = await getCourtDay({ db: counted(tx) as Transaction }, actor, { date: DAY, scope: 'workspace' });
      expect(day.complexes).toHaveLength(2);
      expect(day.complexes.flatMap((c) => c.halls.flatMap((h) => h.lists.flatMap((l) => l.items)))).toHaveLength(40);
      expect(statements).toBeLessThanOrEqual(6);

      const samples: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        await getCourtDay({ db: tx }, actor, { date: DAY, scope: 'workspace' });
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      const p95 = samples[Math.ceil(samples.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
      expect(p95).toBeLessThan(150);
    });
  });
});
