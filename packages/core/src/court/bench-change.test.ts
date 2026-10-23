// Bench-change alerts (#389, part 4 of #39; ADR 0017): a new roster's hall and portfolio changes
// become one alert per proceeding, never twice; members hear about them through the notification
// centre with counts only unless they opted in to party names, and only about matters they may
// read; every created alert emits `bench.changed`.
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
import { setBenchAlertPartyNames, type DeliveryJob } from '@causedeck/notifications';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { addMember, newWorkspace } from '../__tests__/fixtures.ts';
import { WorkspaceError } from '../shared/errors.ts';

import {
  benchChangeTitle,
  detectBenchChanges,
  dismissAlert,
  listAlerts,
  portfolioRuleMatches,
} from './bench-change.ts';
import type { CourtEvent } from './events.ts';
import { confirmRosterImport } from './rosters.ts';

const { benchChangeAlert, matterRestriction, notification } = schema;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorkspaceError);
  return (error as WorkspaceError).code;
}

interface Setup {
  workspaceId: string;
  ownerId: string;
  advocateId: string;
  viewerId: string;
  forumId: string;
  benches: { a: string; b: string; c: string };
  /** Proceedings by role in the scenario. */
  p: {
    hallMoved: string;
    hallSame: string;
    listedBefore: string;
    portfolio: string;
    portfolioNoMatch: string;
    both: string;
  };
  matters: { listed: string; restricted: string; other: string };
  previousRosterId: string;
  rosterId: string;
}

/**
 * Roster P (from 1 Sep): hall 1 → bench A, hall 2 → bench B, CRP from 2020 → bench C.
 * Roster R (from 5 Oct): hall 1 → bench B, hall 2 → bench B, CRP from 2020 → bench A.
 */
async function setup(tx: Transaction): Promise<Setup> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const advocateId = await addMember(tx, workspaceId, 'advocate');
  const viewerId = await addMember(tx, workspaceId, 'viewer');
  const built = await inWorkspace(tx, workspaceId, async (s) => {
    const forum = await buildForum(s, workspaceId);
    const hall1 = await buildCourtHall(s, workspaceId, { forumId: forum.id, hallNo: '1' });
    const hall2 = await buildCourtHall(s, workspaceId, { forumId: forum.id, hallNo: '2' });
    const a = (
      await buildBench(s, workspaceId, {
        forumId: forum.id,
        judges: ['Justice A (fictional)'],
        benchKind: 'single',
      })
    ).id;
    const b = (
      await buildBench(s, workspaceId, {
        forumId: forum.id,
        judges: ['Justice B (fictional)'],
        benchKind: 'single',
      })
    ).id;
    const c = (
      await buildBench(s, workspaceId, {
        forumId: forum.id,
        judges: ['Justice C (fictional)'],
        benchKind: 'single',
      })
    ).id;
    const listed = (await buildMatter(s, workspaceId)).id;
    const restricted = (await buildMatter(s, workspaceId)).id;
    const other = (await buildMatter(s, workspaceId)).id;
    const proceedingIn = async (
      matterId: string,
      values: {
        caseTypeCode?: string;
        year?: number;
        titlePetitioner?: string;
        titleRespondent?: string;
      } = {},
    ) => (await buildProceeding(s, workspaceId, { matterId, forumId: forum.id, ...values })).id;
    const hallMoved = await proceedingIn(listed, {
      titlePetitioner: 'Arul Selvan (fictional)',
      titleRespondent: 'State of Tamil Nadu',
    });
    const both = await proceedingIn(listed, { caseTypeCode: 'CRP', year: 2022 });
    const hallSame = await proceedingIn(other);
    const listedBefore = await proceedingIn(other);
    const portfolio = await proceedingIn(restricted, {
      caseTypeCode: 'CRP',
      year: 2022,
      titlePetitioner: 'Kavya Raman (fictional)',
      titleRespondent: 'Union of India',
    });
    const portfolioNoMatch = await proceedingIn(other, { caseTypeCode: 'CRP', year: 2018 });
    await buildListing(s, workspaceId, {
      proceedingId: hallMoved,
      listDate: '2026-10-10',
      hallId: hall1.id,
    });
    await buildListing(s, workspaceId, {
      proceedingId: both,
      listDate: '2026-10-07',
      hallId: hall1.id,
    });
    await buildListing(s, workspaceId, {
      proceedingId: hallSame,
      listDate: '2026-10-12',
      hallId: hall2.id,
    });
    await buildListing(s, workspaceId, {
      proceedingId: listedBefore,
      listDate: '2026-09-20',
      hallId: hall1.id,
    });
    // The advocate may not read the restricted matter.
    await s
      .insert(matterRestriction)
      .values({ workspaceId, matterId: restricted, allowedUserIds: [ownerId] });
    return {
      forumId: forum.id,
      hall1: hall1.id,
      hall2: hall2.id,
      benches: { a, b, c },
      p: { hallMoved, hallSame, listedBefore, portfolio, portfolioNoMatch, both },
      matters: { listed, restricted, other },
    };
  });
  const actor = { userId: ownerId, workspaceId };
  const { a, b, c } = built.benches;
  const previous = await confirmRosterImport(tx, actor, {
    forumId: built.forumId,
    effectiveFrom: '2026-09-01',
    entries: [
      { hallNo: '1', hallId: built.hall1, benchId: a },
      { hallNo: '2', hallId: built.hall2, benchId: b },
      { hallNo: '3', benchId: c, portfolioRule: { caseTypes: ['CRP'], yearFrom: 2020 } },
    ],
  });
  const roster = await confirmRosterImport(tx, actor, {
    forumId: built.forumId,
    effectiveFrom: '2026-10-05',
    entries: [
      { hallNo: '1', hallId: built.hall1, benchId: b },
      { hallNo: '2', hallId: built.hall2, benchId: b },
      { hallNo: '3', benchId: a, portfolioRule: { caseTypes: ['CRP'], yearFrom: 2020 } },
    ],
  });
  return {
    workspaceId,
    ownerId,
    advocateId,
    viewerId,
    forumId: built.forumId,
    benches: built.benches,
    p: built.p,
    matters: built.matters,
    previousRosterId: previous.roster.id,
    rosterId: roster.roster.id,
  };
}

function recorder() {
  const events: CourtEvent[] = [];
  const jobs: DeliveryJob[] = [];
  return {
    events,
    jobs,
    deps: {
      events: { emit: (e: CourtEvent) => events.push(e) },
      enqueueDelivery: (job: DeliveryJob) => {
        jobs.push(job);
        return Promise.resolve();
      },
    },
  };
}

async function notificationsOf(tx: Transaction, d: Setup) {
  return inWorkspace(tx, d.workspaceId, (s) =>
    s
      .select({
        userId: notification.userId,
        category: notification.category,
        title: notification.title,
        body: notification.body,
        href: notification.href,
      })
      .from(notification)
      .orderBy(asc(notification.createdAt)),
  );
}

const ownerOf = (d: Setup) => ({ userId: d.ownerId, workspaceId: d.workspaceId });

describe('detectBenchChanges (#389)', () => {
  it('writes one hall or portfolio alert per changed proceeding, the hall reason first', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      const { deps } = recorder();
      const created = await detectBenchChanges(tx, ownerOf(d), { rosterId: d.rosterId }, deps);
      const byProceeding = new Map(created.map((a) => [a.proceedingId, a]));
      expect([...byProceeding.keys()].sort()).toEqual(
        [d.p.hallMoved, d.p.both, d.p.portfolio].sort(),
      );
      expect(byProceeding.get(d.p.hallMoved)).toMatchObject({
        rosterId: d.rosterId,
        oldBenchId: d.benches.a,
        newBenchId: d.benches.b,
        reason: 'hall',
        status: 'open',
      });
      // Listed in a moved hall and in a moved portfolio: the hall reason wins.
      expect(byProceeding.get(d.p.both)).toMatchObject({ reason: 'hall', newBenchId: d.benches.b });
      expect(byProceeding.get(d.p.portfolio)).toMatchObject({
        oldBenchId: d.benches.c,
        newBenchId: d.benches.a,
        reason: 'portfolio',
      });
    });
  });

  it('never duplicates on a re-run and treats a forum’s first roster as the baseline', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      const first = recorder();
      expect(
        await detectBenchChanges(tx, ownerOf(d), { rosterId: d.previousRosterId }, first.deps),
      ).toEqual([]);
      expect(first.events).toEqual([]);
      expect(
        await detectBenchChanges(tx, ownerOf(d), { rosterId: d.rosterId }, first.deps),
      ).toHaveLength(3);
      const notified = await notificationsOf(tx, d);
      const again = recorder();
      expect(
        await detectBenchChanges(tx, ownerOf(d), { rosterId: d.rosterId }, again.deps),
      ).toEqual([]);
      expect(again.events).toEqual([]);
      expect(again.jobs).toEqual([]);
      expect(await notificationsOf(tx, d)).toEqual(notified);
      const rows = await inWorkspace(tx, d.workspaceId, (s) => s.select().from(benchChangeAlert));
      expect(rows).toHaveLength(3);
    });
  });

  it('notifies with counts only by default, and only about matters the member may read', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      const { deps, jobs } = recorder();
      await detectBenchChanges(tx, ownerOf(d), { rosterId: d.rosterId }, deps);
      const rows = await notificationsOf(tx, d);
      const owner = rows.filter((r) => r.userId === d.ownerId);
      const advocate = rows.filter((r) => r.userId === d.advocateId);
      expect(owner).toHaveLength(1);
      expect(owner[0]).toMatchObject({
        category: 'reminder.hearing',
        title: '2 matters have a bench change from 05 Oct',
        body: null,
      });
      expect(owner[0]?.href).toMatch(/^\/w\/.+\/courts$/);
      // The restricted matter is hidden from the advocate.
      expect(advocate).toHaveLength(1);
      expect(advocate[0]).toMatchObject({
        title: '1 matter has a bench change from 05 Oct',
        body: null,
      });
      const text = JSON.stringify(rows);
      for (const party of ['Arul', 'Kavya', 'State of Tamil Nadu', 'Union of India', 'Justice']) {
        expect(text).not.toContain(party);
      }
      // The viewer reads matters too; email and push deliveries follow the category defaults.
      expect(rows.some((r) => r.userId === d.viewerId)).toBe(true);
      expect(jobs.length).toBeGreaterThan(0);
    });
  });

  it('names the parties only to a member who opted in', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      await setBenchAlertPartyNames(
        { db: tx, workspaceId: d.workspaceId },
        { userId: d.ownerId, enabled: true },
      );
      await detectBenchChanges(tx, ownerOf(d), { rosterId: d.rosterId }, recorder().deps);
      const rows = await notificationsOf(tx, d);
      const owner = rows.find((r) => r.userId === d.ownerId);
      expect(owner?.title).toBe('2 matters have a bench change from 05 Oct');
      expect(owner?.body).toContain('Arul Selvan (fictional) v State of Tamil Nadu');
      expect(owner?.body).toContain('Kavya Raman (fictional) v Union of India');
      const advocate = rows.find((r) => r.userId === d.advocateId);
      expect(advocate?.body).toBeNull();
    });
  });

  it('emits bench.changed once per created alert', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      const { deps, events } = recorder();
      const created = await detectBenchChanges(tx, ownerOf(d), { rosterId: d.rosterId }, deps);
      expect(events).toHaveLength(created.length);
      const moved = created.find((a) => a.proceedingId === d.p.hallMoved);
      expect(events.find((e) => e.proceedingId === d.p.hallMoved)).toEqual({
        type: 'bench.changed',
        workspaceId: d.workspaceId,
        actorUserId: d.ownerId,
        matterId: d.matters.listed,
        sensitive: false,
        proceedingId: d.p.hallMoved,
        alertId: moved?.id,
        rosterId: d.rosterId,
        forumId: d.forumId,
        effectiveFrom: '2026-10-05',
        oldBenchId: d.benches.a,
        newBenchId: d.benches.b,
        reason: 'hall',
      });
      expect(events.find((e) => e.proceedingId === d.p.portfolio)?.matterId).toBe(
        d.matters.restricted,
      );
    });
  });

  it('needs matter.write and a confirmed roster of the workspace', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      const viewer = { userId: d.viewerId, workspaceId: d.workspaceId };
      expect(
        await codeOf(detectBenchChanges(tx, viewer, { rosterId: d.rosterId }, recorder().deps)),
      ).toBe('FORBIDDEN');
      expect(
        await codeOf(
          detectBenchChanges(tx, ownerOf(d), { rosterId: crypto.randomUUID() }, recorder().deps),
        ),
      ).toBe('NOT_FOUND');
      expect(
        await codeOf(detectBenchChanges(tx, ownerOf(d), { rosterId: 'x' }, recorder().deps)),
      ).toBe('VALIDATION');
    });
  });
});

describe('listAlerts and dismissAlert (#389)', () => {
  it('lists alerts on readable matters and dismisses them', async () => {
    await withTestDb(async (tx) => {
      const d = await setup(tx);
      await detectBenchChanges(tx, ownerOf(d), { rosterId: d.rosterId }, recorder().deps);
      const advocate = { userId: d.advocateId, workspaceId: d.workspaceId };
      const viewer = { userId: d.viewerId, workspaceId: d.workspaceId };
      expect(await listAlerts(tx, ownerOf(d))).toHaveLength(3);
      const visible = await listAlerts(tx, advocate);
      expect(visible.map((a) => a.proceedingId).sort()).toEqual([d.p.hallMoved, d.p.both].sort());
      expect(await listAlerts(tx, ownerOf(d), { proceedingId: d.p.portfolio })).toHaveLength(1);

      const hidden = (await listAlerts(tx, ownerOf(d), { proceedingId: d.p.portfolio }))[0];
      expect(await codeOf(dismissAlert(tx, advocate, { alertId: hidden?.id ?? '' }))).toBe(
        'NOT_FOUND',
      );
      const target = visible[0];
      expect(await codeOf(dismissAlert(tx, viewer, { alertId: target?.id ?? '' }))).toBe(
        'FORBIDDEN',
      );
      const dismissed = await dismissAlert(tx, advocate, { alertId: target?.id ?? '' });
      expect(dismissed.status).toBe('dismissed');
      expect((await dismissAlert(tx, advocate, { alertId: target?.id ?? '' })).status).toBe(
        'dismissed',
      );
      expect(await listAlerts(tx, ownerOf(d), { status: 'open' })).toHaveLength(2);
      expect(
        await listAlerts(tx, ownerOf(d), { status: 'dismissed', rosterId: d.rosterId }),
      ).toHaveLength(1);
      const [row] = await inWorkspace(tx, d.workspaceId, (s) =>
        s
          .select()
          .from(benchChangeAlert)
          .where(eq(benchChangeAlert.id, target?.id ?? '')),
      );
      expect(row?.status).toBe('dismissed');
    });
  });
});

describe('bench-change helpers (#389)', () => {
  it('matches case types and the year range; subject tags alone match nothing', () => {
    const wp2022 = { caseTypeCode: 'WP', year: 2022 };
    expect(portfolioRuleMatches({ caseTypes: ['WP'] }, wp2022)).toBe(true);
    expect(portfolioRuleMatches({ caseTypes: ['CRP'] }, wp2022)).toBe(false);
    expect(portfolioRuleMatches({ yearFrom: 2020, yearTo: 2022 }, wp2022)).toBe(true);
    expect(portfolioRuleMatches({ yearFrom: 2023 }, wp2022)).toBe(false);
    expect(portfolioRuleMatches({ yearTo: 2020 }, { caseTypeCode: 'WP', year: null })).toBe(false);
    expect(portfolioRuleMatches({ subjectTags: ['tax'] }, wp2022)).toBe(false);
    expect(portfolioRuleMatches({}, wp2022)).toBe(false);
    expect(portfolioRuleMatches(null, wp2022)).toBe(false);
  });

  it('writes the counts-only title', () => {
    expect(benchChangeTitle(2, '2026-10-05')).toBe('2 matters have a bench change from 05 Oct');
    expect(benchChangeTitle(1, '2026-01-31')).toBe('1 matter has a bench change from 31 Jan');
  });
});
