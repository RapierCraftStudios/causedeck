// Bench-notice alerts (#496): the title classifier (leave, special bench, roster reassignment,
// halls, case types), the read model that maps a notice to the listings and matters it affects,
// and one alert per member per notice. Judges are never read.
import { Secret } from '@causedeck/config/env';
import { schema, type Transaction } from '@causedeck/db';
import { seedForumCatalogue } from '@causedeck/db/seed/forum-catalogue';
import { createDb, inWorkspace, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addMember, newWorkspace } from '../__tests__/fixtures.ts';

import {
  classifyBenchNotice,
  listBenchNoticeAlerts,
  notifyBenchNoticeAlerts,
} from './bench-alerts.ts';

const owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });

beforeAll(async () => {
  // Committed, as `pnpm db:migrate` leaves it: the test db does not carry the forum catalogue.
  await seedForumCatalogue(owner);
});

afterAll(async () => {
  await owner.$client.end();
});

const SOURCE = 'in.tn.madras-hc.notices';
const MADURAI = 'in.tn.madras-hc.madurai';
const BENGALURU = 'in.ka.karnataka-hc.bengaluru';

describe('classifyBenchNotice', () => {
  it('reads a special bench with its case type', () => {
    expect(classifyBenchNotice('Special Bench to hear W.P. matters on 05.11.2026')).toEqual({
      type: 'special_bench',
      hallNos: [],
      caseTypes: ['WP'],
    });
  });

  it('reads a leave notice with its court halls', () => {
    expect(
      classifyBenchNotice('Hon. Judge sitting in Court Hall Nos. 12A and 7 is on leave'),
    ).toEqual({ type: 'leave', hallNos: ['12A', '7'], caseTypes: [] });
  });

  it('reads a roster reassignment by case category', () => {
    expect(classifyBenchNotice('Roster change: Criminal Appeals and WP to Court 4')).toEqual({
      type: 'roster_reassignment',
      hallNos: ['4'],
      caseTypes: ['CRLA', 'WP'],
    });
  });

  it('returns null for an unrelated notice and for one naming neither hall nor case type', () => {
    expect(classifyBenchNotice('Holiday list for 2027')).toBeNull();
    expect(classifyBenchNotice('Special bench will sit on Saturday')).toBeNull();
  });
});

interface World {
  workspaceId: string;
  ownerId: string;
  matterId: string;
  /** The code of the forum the matter's proceedings sit before. */
  forumCode: string;
}

/** A matter before `forumCode`, a `caseType` proceeding, and a listing on `listDate` in `hallNo`. */
async function matterListed(
  tx: Transaction,
  forumCode: string,
  opts: { caseType?: string; hallNo?: string; listDate?: string; world?: World } = {},
): Promise<World> {
  const base = opts.world ?? { ...(await newWorkspace(tx)), matterId: '', forumCode };
  const { workspaceId, ownerId } = base;
  // A hall's forum must share its workspace scope, so a hall needs a workspace-scoped forum.
  let code = base.forumCode;
  if (opts.hallNo !== undefined && opts.world === undefined) {
    code = `${forumCode}.xt-${crypto.randomUUID().slice(0, 8)}`;
    await inWorkspace(tx, workspaceId, (s) =>
      s.insert(schema.forum).values({
        workspaceId,
        code,
        court: 'Bench Test Court',
        jurisdictionKind: 'high_court',
      }),
    );
  }
  const [forum] = await tx
    .select({ id: schema.forum.id })
    .from(schema.forum)
    .where(eq(schema.forum.code, code));
  const matterId = await inWorkspace(tx, workspaceId, async (s) => {
    const [m] = await s
      .insert(schema.matter)
      .values({ workspaceId, title: 'Bench matter', practiceArea: 'civil' })
      .returning({ id: schema.matter.id });
    const [p] = await s
      .insert(schema.proceeding)
      .values({
        workspaceId,
        matterId: m?.id ?? '',
        forumId: forum?.id ?? '',
        caseTypeCode: opts.caseType ?? 'WP',
        caseTypeRaw: opts.caseType ?? 'W.P.',
        filingNo: `F-${crypto.randomUUID().slice(0, 8)}`,
        sourceType: 'manual',
      })
      .returning({ id: schema.proceeding.id });
    let hallId: string | null = null;
    if (opts.hallNo !== undefined) {
      const [h] = await s
        .insert(schema.courtHall)
        .values({ workspaceId, forumId: forum?.id ?? '', hallNo: opts.hallNo })
        .returning({ id: schema.courtHall.id });
      hallId = h?.id ?? null;
    }
    await s.insert(schema.listing).values({
      workspaceId,
      proceedingId: p?.id ?? '',
      hallId,
      listDate: opts.listDate ?? '2026-11-05',
      listType: 'daily',
      stageRaw: 'For Orders',
      sourceType: 'manual',
    });
    return m?.id ?? '';
  });
  return { workspaceId, ownerId, matterId, forumCode: code };
}

/** A notice for `forumCodes`, matched to every matter of `world` (as `matchNotices` would). */
async function noticeFor(
  tx: Transaction,
  world: World,
  title: string,
  forumCodes = [world.forumCode],
) {
  const [row] = await tx
    .insert(schema.notice)
    .values({
      sourceId: SOURCE,
      forumCodes,
      kind: 'circular',
      title,
      issuedOn: '2026-11-02',
      url: `https://notices.example.test/bench/${crypto.randomUUID()}`,
      sourceType: 'adapter',
      sourceRef: 'test',
    })
    .returning({ id: schema.notice.id });
  const noticeId = row?.id ?? '';
  await inWorkspace(tx, world.workspaceId, async (s) => {
    const proceedings = await s.select().from(schema.proceeding);
    for (const p of proceedings) {
      await s.insert(schema.noticeMatch).values({
        workspaceId: world.workspaceId,
        noticeId,
        forumId: p.forumId,
        matterId: p.matterId,
        reason: 'matter_forum',
      });
    }
  });
  return noticeId;
}

const notificationsOf = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) =>
    s.select().from(schema.notification).where(eq(schema.notification.category, 'bench_change')),
  );

describe('listBenchNoticeAlerts', () => {
  it('maps a hall leave notice to the matter listed in that hall, with the notice linked', async () => {
    await withTestDb(async (tx) => {
      const world = await matterListed(tx, MADURAI, { hallNo: '12A' });
      const noticeId = await noticeFor(tx, world, 'Judge of Court Hall 12A is on leave');
      const alerts = await listBenchNoticeAlerts(tx, {
        workspaceId: world.workspaceId,
        userId: world.ownerId,
      });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        noticeId,
        matterId: world.matterId,
        type: 'leave',
        listDates: ['2026-11-05'],
        url: expect.stringContaining('https://notices.example.test/bench/') as string,
      });
    });
  });

  it('affects only the named case types for a category-based roster assignment', async () => {
    await withTestDb(async (tx) => {
      const wp = await matterListed(tx, MADURAI, { caseType: 'WP' });
      const both = await matterListed(tx, MADURAI, { caseType: 'SA', world: wp });
      await noticeFor(tx, both, 'Roster: Writ Petitions are reassigned to Bench II');
      const alerts = await listBenchNoticeAlerts(tx, {
        workspaceId: wp.workspaceId,
        userId: wp.ownerId,
      });
      expect(alerts.map((a) => a.matterId)).toEqual([wp.matterId]);
    });
  });

  it('gives nothing for another hall, case type, forum or a listing outside the window', async () => {
    await withTestDb(async (tx) => {
      const hall = await matterListed(tx, MADURAI, { hallNo: '3' });
      await noticeFor(tx, hall, 'Judge of Court Hall 12A is on leave');
      expect(
        await listBenchNoticeAlerts(tx, { workspaceId: hall.workspaceId, userId: hall.ownerId }),
      ).toEqual([]);

      const type = await matterListed(tx, MADURAI, { caseType: 'SA' });
      await noticeFor(tx, type, 'Special bench for W.P. matters');
      expect(
        await listBenchNoticeAlerts(tx, { workspaceId: type.workspaceId, userId: type.ownerId }),
      ).toEqual([]);

      const forum = await matterListed(tx, BENGALURU);
      await noticeFor(tx, forum, 'Special bench for W.P. matters');
      expect(
        await listBenchNoticeAlerts(tx, { workspaceId: forum.workspaceId, userId: forum.ownerId }),
      ).toEqual([]);

      const late = await matterListed(tx, MADURAI, { listDate: '2027-03-01' });
      await noticeFor(tx, late, 'Special bench for W.P. matters');
      expect(
        await listBenchNoticeAlerts(tx, { workspaceId: late.workspaceId, userId: late.ownerId }),
      ).toEqual([]);
    });
  });

  it('narrows to one matter and hides the others', async () => {
    await withTestDb(async (tx) => {
      const first = await matterListed(tx, MADURAI);
      const second = await matterListed(tx, MADURAI, { world: first });
      await noticeFor(tx, second, 'Special bench for W.P. matters');
      const only = await listBenchNoticeAlerts(
        tx,
        { workspaceId: first.workspaceId, userId: first.ownerId },
        { matterId: first.matterId },
      );
      expect(only.map((a) => a.matterId)).toEqual([first.matterId]);
    });
  });
});

describe('notifyBenchNoticeAlerts', () => {
  it('alerts each member once per notice, on a re-run and on a replay', async () => {
    await withTestDb(async (tx) => {
      const world = await matterListed(tx, MADURAI);
      const noticeId = await noticeFor(tx, world, 'Special bench for W.P. matters');
      const deliveries: unknown[] = [];
      const deps = {
        db: tx,
        enqueueDelivery: (job: unknown) => Promise.resolve(deliveries.push(job)),
      };
      const matches = [{ workspaceId: world.workspaceId, noticeId }];

      expect(await notifyBenchNoticeAlerts(deps, matches)).toBe(1);
      const rows = await notificationsOf(tx, world.workspaceId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ dedupeKey: `bench-notice:${noticeId}` });
      expect(rows[0]?.body).toContain('1 of your listed matters');
      expect(rows[0]?.body).not.toContain('Bench matter');

      await notifyBenchNoticeAlerts(deps, [...matches, ...matches]);
      expect(await notificationsOf(tx, world.workspaceId)).toHaveLength(1);
    });
  });

  it('does not alert a member who may not read the matter, nor for an unaffected matter', async () => {
    await withTestDb(async (tx) => {
      const world = await matterListed(tx, MADURAI, { hallNo: '3' });
      const junior = await addMember(tx, world.workspaceId, 'junior');
      const hit = await noticeFor(tx, world, 'Special bench for W.P. matters');
      const miss = await noticeFor(tx, world, 'Judge of Court Hall 9 is on leave');
      const deps = { db: tx, enqueueDelivery: () => Promise.resolve() };
      await notifyBenchNoticeAlerts(deps, [
        { workspaceId: world.workspaceId, noticeId: hit },
        { workspaceId: world.workspaceId, noticeId: miss },
      ]);
      const rows = await notificationsOf(tx, world.workspaceId);
      expect(rows.map((r) => [r.userId, r.dedupeKey])).toEqual([
        [world.ownerId, `bench-notice:${hit}`],
      ]);
      expect(rows.some((r) => r.userId === junior)).toBe(false);
    });
  });
});
