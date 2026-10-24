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

import { listMatterNotices, listWorkspaceNotices } from './list.ts';
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
  const { workspaceId, ownerId } = await newWorkspace(tx);
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
  return { workspaceId, matterId, ownerId };
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

describe('listing notices (#588)', () => {
  it('lists a notice once with provenance, to the workspace and matter it affects only', async () => {
    await withTestDb(async (tx) => {
      const user = await usesForum(tx, MADURAI);
      const other = await usesForum(tx, 'in.ka.karnataka-hc.bengaluru');
      await pollNotices(deps(tx, fakeFetcher()));

      const mine = await listWorkspaceNotices(tx, { workspaceId: user.workspaceId, userId: user.ownerId });
      // The holiday notice matched by a forum row and a matter row is one entry.
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        kind: 'holiday',
        sourceId: SOURCE,
        matterCount: 1,
        url: expect.stringContaining('/notices/holiday-2027.pdf'),
      });
      expect(mine[0]?.sourceName).toBeTruthy();
      expect(mine[0]?.recordedAt).toBeInstanceOf(Date);

      const forMatter = await listMatterNotices(
        tx,
        { workspaceId: user.workspaceId, userId: user.ownerId },
        user.matterId,
      );
      expect(forMatter.map((n) => n.id)).toEqual(mine.map((n) => n.id));

      expect(
        await listWorkspaceNotices(tx, { workspaceId: other.workspaceId, userId: other.ownerId }),
      ).toEqual([]);
      // Another workspace's matter is not found, never an empty list.
      await expect(
        listMatterNotices(
          tx,
          { workspaceId: other.workspaceId, userId: other.ownerId },
          user.matterId,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('leaves a sensitive matter out of both reads', async () => {
    await withTestDb(async (tx) => {
      const user = await usesForum(tx, MADURAI);
      await pollNotices(deps(tx, fakeFetcher()));
      await inWorkspace(tx, user.workspaceId, (s) =>
        s.update(schema.matter).set({ sensitive: true }).where(eq(schema.matter.id, user.matterId)),
      );
      const actor = { workspaceId: user.workspaceId, userId: user.ownerId };
      await expect(listMatterNotices(tx, actor, user.matterId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      const rows = await listWorkspaceNotices(tx, actor);
      // The forum-level match remains; the sensitive matter is not counted.
      expect(rows.map((n) => n.matterCount)).toEqual([0]);
    });
  });
});
