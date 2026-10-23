// KHC cause-list watch (#482): nothing is fetched while the flag is off or the source uncleared; one
// publication is fetched once however many workspaces watch it; matches become L2 proposals that
// name the publication and are never applied; a repeat poll of the same bytes does nothing; other
// advocates' rows are never stored; the committed golden HTML parses as it does in the adapter.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { schema, type Database, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../__tests__/fixtures.ts';
import { SourceNotCleared } from '../sources/index.ts';

import {
  addCauseListWatch,
  createKhcListParser,
  getPublicationForRef,
  KHC_CAUSE_LIST_SOURCE_ID,
  listCauseListWatches,
  pollCauseList,
  PUBLICATION_REF_PREFIX,
  removeCauseListWatch,
  type ListFetcher,
  type PollCauseListDeps,
} from './list-watch.ts';

const FIXTURE_DIR = path.resolve(
  import.meta.dirname,
  '../../../adapters/fixtures/in.ka.karnataka-hc.bengaluru',
);
const read = (file: string) => readFileSync(path.join(FIXTURE_DIR, file), 'utf8');
const DAILY = read('list-01-daily-three-halls-two-lists.input.html');
const ADVANCE = read('list-03-advance.input.html');
const NOW = new Date('2026-10-21T04:00:00.000Z');

/** A fetcher serving `pages` by URL suffix, counting provider calls. */
function fakeFetcher(pages: Record<string, string>): ListFetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchSource(_sourceId, url) {
      calls.push(url);
      const key = Object.keys(pages).find((suffix) => url.endsWith(suffix));
      if (key === undefined) throw new Error(`no page for ${url}`);
      return Promise.resolve({
        body: pages[key] ?? '',
        provenance: { url, fetchedAt: NOW.toISOString(), sha256: `sha-${key}-${(pages[key] ?? '').length}` },
      });
    },
  };
}

const open = { baseUrl: 'https://khc.example.test/' };
function deps(
  tx: Transaction,
  fetcher: ListFetcher,
  extra: Partial<PollCauseListDeps> = {},
): PollCauseListDeps {
  return {
    db: tx as unknown as Database,
    fetcher,
    clock: { now: () => NOW },
    flagEnabled: () => Promise.resolve(true),
    policy: () => Promise.resolve(open),
    ...extra,
  };
}

const pages = { 'causelist/daily': DAILY, 'causelist/advance': ADVANCE };

async function watcher(tx: Transaction, value = 'KAR/1234/2001') {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  await addCauseListWatch({ db: tx }, { userId: ownerId, workspaceId }, { kind: 'brn', value });
  return { userId: ownerId, workspaceId };
}

const proposalsOf = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) => s.select().from(schema.proposal));

describe('watch services', () => {
  it('adds idempotently, lists and removes only the member’s own watch', async () => {
    await withTestDb(async (tx) => {
      const a = await watcher(tx);
      const b = await watcher(tx);
      const again = await addCauseListWatch({ db: tx }, a, { kind: 'brn', value: ' kar/1234/2001 ' });
      expect(await listCauseListWatches({ db: tx }, a)).toHaveLength(1);
      expect(await listCauseListWatches({ db: tx }, b)).toHaveLength(1);
      await expect(removeCauseListWatch({ db: tx }, b, again.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await removeCauseListWatch({ db: tx }, a, again.id);
      expect(await listCauseListWatches({ db: tx }, a)).toEqual([]);
    });
  });

  it('rejects an invalid BRN and an empty name', async () => {
    await withTestDb(async (tx) => {
      const a = await watcher(tx);
      await expect(addCauseListWatch({ db: tx }, a, { kind: 'brn', value: 'nope' })).rejects.toThrow();
      await expect(addCauseListWatch({ db: tx }, a, { kind: 'name', value: '  ' })).rejects.toThrow();
    });
  });
});

describe('pollCauseList', () => {
  it('fetches nothing while the flag is off', async () => {
    await withTestDb(async (tx) => {
      await watcher(tx);
      const fetcher = fakeFetcher(pages);
      const report = await pollCauseList(deps(tx, fetcher, { flagEnabled: () => Promise.resolve(false) }));
      expect(report.outcome).toBe('flag_off');
      expect(fetcher.calls).toEqual([]);
    });
  });

  it('fetches nothing while the source is uncleared', async () => {
    await withTestDb(async (tx) => {
      await watcher(tx);
      const fetcher = fakeFetcher(pages);
      const report = await pollCauseList(
        deps(tx, fetcher, {
          policy: () => Promise.reject(new SourceNotCleared('uncleared', KHC_CAUSE_LIST_SOURCE_ID)),
        }),
      );
      expect(report.outcome).toBe('source_not_cleared');
      expect(fetcher.calls).toEqual([]);
    });
  });

  it('fetches nothing when nobody watches', async () => {
    await withTestDb(async (tx) => {
      const fetcher = fakeFetcher(pages);
      expect((await pollCauseList(deps(tx, fetcher))).outcome).toBe('no_watchers');
      expect(fetcher.calls).toEqual([]);
    });
  });

  it('fetches each list once for many workspaces and stages unconfirmed proposals with provenance', async () => {
    await withTestDb(async (tx) => {
      const a = await watcher(tx);
      const b = await watcher(tx);
      const other = await watcher(tx, 'KAR/9999/1999');
      const fetcher = fakeFetcher(pages);
      const report = await pollCauseList(deps(tx, fetcher));

      expect(fetcher.calls).toHaveLength(2);
      expect(report.fetched).toBe(2);
      const publications = await tx.select().from(schema.causeListPublication);
      expect(publications).toHaveLength(2);
      expect(publications.every((p) => p.completedAt !== null && p.rowCount > 0)).toBe(true);
      // The publication row holds metadata only.
      expect(Object.keys(publications[0] ?? {}).sort()).toEqual(
        ['completedAt', 'fetchedAt', 'id', 'listKey', 'rowCount', 'sha256', 'sourceId', 'url'].sort(),
      );

      for (const member of [a, b]) {
        const rows = await proposalsOf(tx, member.workspaceId);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.status).toBe('proposed');
          expect(row.level).not.toBe('L3');
          expect(JSON.stringify(row.meta)).toContain(PUBLICATION_REF_PREFIX);
        }
      }
      expect(await proposalsOf(tx, other.workspaceId)).toEqual([]);

      const ref = JSON.stringify((await proposalsOf(tx, a.workspaceId))[0]?.meta);
      const id = /cause_list_publication:([0-9a-f-]{36})/.exec(ref)?.[1];
      const pub = await getPublicationForRef({ db: tx }, `${PUBLICATION_REF_PREFIX}${id}`);
      expect(pub?.url).toContain('causelist/');
      expect(pub?.fetchedAt.toISOString()).toBe(NOW.toISOString());
      expect(await getPublicationForRef({ db: tx }, 'something:else')).toBeNull();
    });
  });

  it('does nothing for a publication it has already matched', async () => {
    await withTestDb(async (tx) => {
      const a = await watcher(tx);
      const fetcher = fakeFetcher(pages);
      await pollCauseList(deps(tx, fetcher));
      const before = await proposalsOf(tx, a.workspaceId);
      const again = await pollCauseList(deps(tx, fetcher));
      expect(again.unchanged).toBe(2);
      expect(again.proposals).toBe(0);
      expect(await proposalsOf(tx, a.workspaceId)).toHaveLength(before.length);
      const rows = await tx
        .select()
        .from(schema.causeListPublication)
        .where(eq(schema.causeListPublication.sourceId, KHC_CAUSE_LIST_SOURCE_ID));
      expect(rows).toHaveLength(2);
    });
  });
});

describe('golden fixtures through the fetched-HTML path', () => {
  it.each([
    ['list-01-daily-three-halls-two-lists'],
    ['list-03-advance'],
  ])('%s parses to its expected rows', async (name) => {
    const expected = JSON.parse(read(`${name}.expected.json`)) as {
      rows: { matchKey: string | null; advocates?: unknown[] }[];
    };
    const parsed = await createKhcListParser()(read(`${name}.input.html`), '2026-10-21T04:00:00.000Z');
    expect(parsed.rows.map((r) => r.matchKey)).toEqual(expected.rows.map((r) => r.matchKey));
    expect(parsed.rows.map((r) => r.advocates?.length ?? 0)).toEqual(
      expected.rows.map((r) => r.advocates?.length ?? 0),
    );
  });
});
