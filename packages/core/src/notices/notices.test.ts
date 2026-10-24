// The notices poll (#586): an uncleared source is never fetched and is logged "skipped: not
// cleared"; a cleared source is fetched once per run, its notices are stored once (a repeat poll
// inserts nothing) with provenance; a source without a parser is skipped; matching reaches only the
// workspaces and matters with a proceeding before a forum the notice names.
import { Secret } from '@causedeck/config/env';
import { schema, type Transaction } from '@causedeck/db';
import { seedForumCatalogue } from '@causedeck/db/seed/forum-catalogue';
import { createDb, inWorkspace, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newWorkspace } from '../__tests__/fixtures.ts';
import { runNoticesPoll } from '../jobs/index.ts';

import { listHolidayListings } from './holidays.ts';
import { matchNotices } from './match.ts';
import { pollNotices, type NoticeFetcher, type PollNoticesDeps } from './poll.ts';

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
const PAGE = `<table>
  <tr><td>05-11-2026</td><td><a href="/notices/holiday-2027.pdf">Holiday list for 2027 of Madurai Bench</a></td></tr>
  <tr><td>06-11-2026</td><td><a href="/notices/roster.pdf">Roster for the Principal Bench</a></td></tr>
  <tr><td>no date</td><td><a href="/notices/undated.pdf">Undated circular</a></td></tr>
</table>`;
const open = { baseUrl: 'https://mhc.example.test/notices' };

function fakeFetcher(body = PAGE): NoticeFetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchSource(_sourceId, url) {
      calls.push(url);
      return Promise.resolve({
        body,
        provenance: { url, fetchedAt: '2026-11-05T00:00:00.000Z', sha256: 'a'.repeat(64) },
      });
    },
  };
}

function deps(tx: Transaction, fetcher: NoticeFetcher, extra: Partial<PollNoticesDeps> = {}) {
  return {
    db: tx,
    fetcher,
    sourceId: SOURCE,
    policy: () => Promise.resolve(open),
    ...extra,
  } satisfies PollNoticesDeps;
}

/** A matter with a proceeding before the catalogue forum `code`, in a fresh workspace. */
async function usesForum(tx: Transaction, code: string) {
  const { workspaceId } = await newWorkspace(tx);
  const [forum] = await tx
    .select({ id: schema.forum.id })
    .from(schema.forum)
    .where(eq(schema.forum.code, code));
  const matterId = await inWorkspace(tx, workspaceId, async (s) => {
    const [m] = await s
      .insert(schema.matter)
      .values({ workspaceId, title: 'Notice matter', practiceArea: 'civil' })
      .returning({ id: schema.matter.id });
    await s.insert(schema.proceeding).values({
      workspaceId,
      matterId: m?.id ?? '',
      forumId: forum?.id ?? '',
      caseTypeCode: 'WP',
      caseTypeRaw: 'W.P.',
      filingNo: 'F-NOTICE',
      sourceType: 'manual',
    });
    return m?.id ?? '';
  });
  return { workspaceId, matterId };
}

const matchesOf = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) => s.select().from(schema.noticeMatch));

describe('pollNotices', () => {
  it('never fetches an uncleared source and logs "skipped: not cleared"', async () => {
    await withTestDb(async (tx) => {
      const fetcher = fakeFetcher();
      const events: string[] = [];
      // The migration-seeded source is uncleared: the default policy refuses it.
      const report = await pollNotices({
        db: tx,
        fetcher,
        sourceId: SOURCE,
        log: (event) => events.push(event),
      });
      expect(fetcher.calls).toEqual([]);
      expect(events).toEqual(['skipped: not cleared']);
      expect(report).toMatchObject({ sources: 0, skipped: 1, inserted: 0 });
    });
  });

  it('polls every notice source and skips the uncleared ones without fetching', async () => {
    await withTestDb(async (tx) => {
      const fetcher = fakeFetcher();
      const report = await pollNotices({ db: tx, fetcher });
      expect(fetcher.calls).toEqual([]);
      expect(report.skipped).toBeGreaterThanOrEqual(8);
    });
  });

  it('stores each notice once with provenance and fetches the page once per run', async () => {
    await withTestDb(async (tx) => {
      const fetcher = fakeFetcher();
      const first = await pollNotices(deps(tx, fetcher));
      expect(fetcher.calls).toEqual([open.baseUrl]);
      expect(first).toMatchObject({ sources: 1, inserted: 2, duplicates: 0, unreadable: 1 });
      const stored = await tx
        .select()
        .from(schema.notice)
        .where(eq(schema.notice.sourceId, SOURCE));
      expect(stored.map((n) => n.kind).sort()).toEqual(['holiday', 'roster']);
      expect(stored.every((n) => n.sourceType === 'adapter' && n.sourceRef === n.url)).toBe(true);
      expect(stored.every((n) => n.documentKey === null)).toBe(true);

      const again = await pollNotices(deps(tx, fakeFetcher()));
      expect(again).toMatchObject({ inserted: 0, duplicates: 2, matches: 0 });
      expect(
        await tx.select().from(schema.notice).where(eq(schema.notice.sourceId, SOURCE)),
      ).toHaveLength(2);
    });
  });

  it('skips a cleared source that has no parser, and counts a failed fetch', async () => {
    await withTestDb(async (tx) => {
      const fetcher = fakeFetcher();
      const noParser = await pollNotices(deps(tx, fetcher, { sourceId: 'in.sc.notices' }));
      expect(noParser).toMatchObject({ sources: 0, skipped: 1 });
      expect(fetcher.calls).toEqual([]);

      const failing: NoticeFetcher = { fetchSource: () => Promise.reject(new Error('down')) };
      const failed = await pollNotices(deps(tx, failing));
      expect(failed).toMatchObject({ sources: 0, failed: 1, inserted: 0 });
    });
  });

  it('matches a new notice to the workspaces and matters that use its forum only', async () => {
    await withTestDb(async (tx) => {
      const user = await usesForum(tx, MADURAI);
      const other = await usesForum(tx, 'in.ka.karnataka-hc.bengaluru');
      const report = await pollNotices(deps(tx, fakeFetcher()));
      expect(report.matches).toBeGreaterThanOrEqual(2);
      const mine = await matchesOf(tx, user.workspaceId);
      // The holiday notice names Madurai; the roster notice names the Principal Bench only.
      expect(mine.map((m) => [m.reason, m.matterId]).sort()).toEqual(
        [
          ['forum', null],
          ['matter_forum', user.matterId],
        ].sort(),
      );
      expect(await matchesOf(tx, other.workspaceId)).toEqual([]);
      // A repeat poll writes no second match.
      await pollNotices(deps(tx, fakeFetcher()));
      expect(await matchesOf(tx, user.workspaceId)).toHaveLength(2);
    });
  });
});

describe('notice alerts', () => {
  const notificationsOf = (tx: Transaction, workspaceId: string) =>
    inWorkspace(tx, workspaceId, (s) => s.select().from(schema.notification));

  it('alerts each member once per matched notice and never twice on a re-poll', async () => {
    await withTestDb(async (tx) => {
      const user = await usesForum(tx, MADURAI);
      const other = await usesForum(tx, 'in.ka.karnataka-hc.bengaluru');
      const deliveries: unknown[] = [];
      const enqueueDelivery = (job: unknown) => Promise.resolve(deliveries.push(job));

      const first = await pollNotices(deps(tx, fakeFetcher(), { enqueueDelivery }));
      // One notice (the Madurai holiday list) names the user's forum; the owner is the only member.
      expect(first.alerts).toBe(1);
      const mine = await notificationsOf(tx, user.workspaceId);
      expect(mine).toHaveLength(1);
      expect(mine[0]?.category).toBe('notices');
      expect(mine[0]?.title).toContain('Madurai');
      expect(mine[0]?.body).toContain('1 of your matters');
      expect(mine[0]?.href).toContain('/courts');
      // `notices` defaults to in-app and push: one push delivery job, no email.
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({ channel: 'push' });
      expect(await notificationsOf(tx, other.workspaceId)).toEqual([]);

      const again = await pollNotices(deps(tx, fakeFetcher(), { enqueueDelivery }));
      expect(again.alerts).toBe(0);
      expect(await notificationsOf(tx, user.workspaceId)).toHaveLength(1);
      expect(deliveries).toHaveLength(1);
    });
  });

  it('sends no alert when no delivery port is given', async () => {
    await withTestDb(async (tx) => {
      const user = await usesForum(tx, MADURAI);
      const report = await pollNotices(deps(tx, fakeFetcher()));
      expect(report.alerts).toBe(0);
      expect(await notificationsOf(tx, user.workspaceId)).toEqual([]);
    });
  });
});

describe('listHolidayListings', () => {
  async function holidayNotice(tx: Transaction, kind: 'holiday' | 'circular', codes: string[]) {
    const [row] = await tx
      .insert(schema.notice)
      .values({
        sourceId: SOURCE,
        forumCodes: codes,
        kind,
        title: 'Court holiday',
        issuedOn: '2026-11-02',
        effectiveOn: '2026-12-25',
        url: `https://notices.example.test/holiday/${crypto.randomUUID()}`,
        sourceType: 'adapter',
        sourceRef: 'test',
      })
      .returning({ id: schema.notice.id, forumCodes: schema.notice.forumCodes });
    return { id: row?.id ?? '', forumCodes: row?.forumCodes ?? [] };
  }

  async function listOn(tx: Transaction, workspaceId: string, matterId: string, date: string) {
    return inWorkspace(tx, workspaceId, async (s) => {
      const [p] = await s
        .select({ id: schema.proceeding.id })
        .from(schema.proceeding)
        .where(eq(schema.proceeding.matterId, matterId));
      const [l] = await s
        .insert(schema.listing)
        .values({
          workspaceId,
          proceedingId: p?.id ?? '',
          listDate: date,
          listType: 'daily',
          stageRaw: 'For Orders',
          sourceType: 'manual',
        })
        .returning({ id: schema.listing.id });
      return l?.id ?? '';
    });
  }

  const range = { from: '2026-12-01', to: '2026-12-31' };

  it('flags a listing on the date of a matched holiday notice for its forum only', async () => {
    await withTestDb(async (tx) => {
      const user = await usesForum(tx, MADURAI);
      const other = await usesForum(tx, 'in.ka.karnataka-hc.bengaluru');
      const onHoliday = await listOn(tx, user.workspaceId, user.matterId, '2026-12-25');
      await listOn(tx, user.workspaceId, user.matterId, '2026-12-26');
      await listOn(tx, other.workspaceId, other.matterId, '2026-12-25');
      const holiday = await holidayNotice(tx, 'holiday', [MADURAI]);
      await matchNotices({ db: tx }, [holiday]);

      const flagged = await listHolidayListings(tx, user.workspaceId, range);
      expect(flagged.map((f) => [f.listingId, f.listDate, f.noticeId, f.matterId])).toEqual([
        [onHoliday, '2026-12-25', holiday.id, user.matterId],
      ]);
      // Another forum's workspace has a listing on the same day but no matched notice.
      expect(await listHolidayListings(tx, other.workspaceId, range)).toEqual([]);
      expect(
        await listHolidayListings(tx, user.workspaceId, { from: '2026-12-26', to: '2026-12-31' }),
      ).toEqual([]);
    });
  });

  it('ignores a notice that is not a holiday', async () => {
    await withTestDb(async (tx) => {
      const user = await usesForum(tx, MADURAI);
      await listOn(tx, user.workspaceId, user.matterId, '2026-12-25');
      await matchNotices({ db: tx }, [await holidayNotice(tx, 'circular', [MADURAI])]);
      expect(await listHolidayListings(tx, user.workspaceId, range)).toEqual([]);
    });
  });
});

describe('runNoticesPoll', () => {
  it('logs the skip through the job log and reports counts', async () => {
    await withTestDb(async (tx) => {
      const lines: string[] = [];
      const log = { info: (_o: unknown, msg: string) => lines.push(msg) };
      const report = await runNoticesPoll(
        { db: tx, log: log as never },
        { sourceId: SOURCE, fetcher: fakeFetcher() },
      );
      expect(report.skipped).toBe(1);
      expect(lines).toEqual(['skipped: not cleared', 'notices poll complete']);
    });
  });
});
