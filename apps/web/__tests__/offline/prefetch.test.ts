import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import { openVault } from '../../lib/offline/crypto.ts';
import {
  type OfflineDb,
  dexieWrappedKeyStore,
  deleteAllOfflineDbs,
  getBrief,
  getCourtDay,
  openOfflineDb,
  putBrief,
  putCourtDay,
} from '../../lib/offline/db.ts';
import {
  type PrefetchDeps,
  PREFETCH_DAYS,
  prefetchWindow,
  readCachedBrief,
  readCachedDay,
  recallScope,
  registerPrefetchSync,
  rememberScope,
  selectDocumentsToCache,
  sessionSecret,
} from '../../lib/offline/prefetch.ts';

const WS = 'ws-1';
const SCOPE = { userId: 'user-a', workspaceId: WS };
const NOW = Date.UTC(2026, 9, 25, 6, 0, 0); // 2026-10-25 IST
const L1 = 'listing-1';
const L2 = 'listing-2';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

const board = (date: string, listingId: string, matterId: string) => ({
  day: {
    date,
    scope: 'mine',
    expectedNotListed: [],
    freshness: null,
    complexes: [
      {
        forumId: 'f1',
        name: 'Madras HC',
        halls: [
          {
            hallId: null,
            hallNo: '4',
            marker: null,
            lists: [{ listType: 'daily', items: [{ listingId, matterId, matterTitle: 'A v. B' }] }],
          },
        ],
      },
    ],
  },
  clashes: [],
  diffs: [],
  failures: [],
});
const brief = (listingId: string, matterId: string) => ({
  listing_id: listingId,
  matter_id: matterId,
  assembled_at: '2026-10-25T00:00:00.000Z',
});

const opened: OfflineDb[] = [];
async function setup() {
  const db = openOfflineDb(SCOPE);
  opened.push(db);
  const vault = await openVault(dexieWrappedKeyStore(db), 'secret');
  return { db, vault };
}
afterEach(async () => {
  for (const db of opened.splice(0)) db.close();
  await deleteAllOfflineDbs();
});

function deps(
  base: { db: OfflineDb; vault: PrefetchDeps['vault'] },
  snapshot: unknown,
  seen: { from?: string; to?: string; known?: unknown } = {},
): PrefetchDeps {
  return {
    ...base,
    workspaceId: WS,
    now: NOW,
    pull: (input) => {
      Object.assign(seen, input);
      return Promise.resolve({ ok: true, data: snapshot as never });
    },
  };
}

describe('prefetchWindow (#65)', () => {
  it('pulls today plus six days, seals days and briefs, and stamps the sync time', async () => {
    const s = await setup();
    const seen: { from?: string; to?: string } = {};
    const snapshot = {
      days: [board('2026-10-25', L1, 'm1'), board('2026-10-26', L2, 'm2')],
      briefs: [brief(L1, 'm1'), brief(L2, 'm2')],
      purge: { listingIds: [], matterIds: [], memberIds: [] },
    };
    const summary = await prefetchWindow(deps(s, snapshot, seen));
    expect(PREFETCH_DAYS).toBe(7);
    expect(seen).toMatchObject({ from: '2026-10-25', to: '2026-10-31' });
    expect(summary).toMatchObject({ days: 2, briefs: 2, purged: 0 });
    const day = await getCourtDay(s.db, s.vault, WS, '2026-10-26', NOW);
    expect((day?.value as { day: { date: string } }).day.date).toBe('2026-10-26');
    expect((await getBrief(s.db, s.vault, WS, L2, NOW))?.value).toMatchObject({ matter_id: 'm2' });
    expect(await s.db.meta.get('lastSyncAt')).toEqual({ id: 'lastSyncAt', value: NOW });
  });

  it('purges revoked listings and matters and evicts days older than yesterday', async () => {
    const s = await setup();
    await putBrief(s.db, s.vault, WS, 'old-listing', '2026-10-24', brief('old-listing', 'm9'), NOW);
    await putBrief(s.db, s.vault, WS, 'gone-matter', '2026-10-26', brief('gone-matter', 'm7'), NOW);
    await putBrief(s.db, s.vault, WS, 'revoked', '2026-10-26', brief('revoked', 'm8'), NOW);
    await putCourtDay(s.db, s.vault, WS, '2026-10-20', { stale: true }, NOW);
    await putBrief(s.db, s.vault, WS, 'ancient', '2026-10-20', brief('ancient', 'm6'), NOW);
    const seen: { known?: { listingIds: string[]; matterIds: string[] } } = {};
    const snapshot = {
      days: [],
      briefs: [],
      purge: { listingIds: ['revoked'], matterIds: ['m7'], memberIds: [] },
    };
    const summary = await prefetchWindow(deps(s, snapshot, seen));
    expect(seen.known?.listingIds).toContain('gone-matter');
    expect(seen.known?.matterIds).toEqual(expect.arrayContaining(['m7', 'm8']));
    expect(summary).toMatchObject({ purged: 2, evicted: 2 });
    expect(await s.db.briefs.toCollection().primaryKeys()).toEqual([[WS, 'old-listing']]);
    expect(await s.db.courtDay.count()).toBe(0);
  });

  it('keeps what is saved when the server refuses', async () => {
    const s = await setup();
    await putCourtDay(s.db, s.vault, WS, '2026-10-25', { kept: true }, NOW);
    const result = await prefetchWindow({
      ...s,
      workspaceId: WS,
      now: NOW,
      pull: () => Promise.resolve({ ok: false }),
    });
    expect(result).toBeNull();
    expect((await getCourtDay(s.db, s.vault, WS, '2026-10-25', NOW))?.value).toEqual({
      kept: true,
    });
  });
});

describe('cache-first reads (#65)', () => {
  it('reads a saved day and brief with the session secret and nothing without it', async () => {
    const storage = memoryStorage();
    const secret = sessionSecret(storage);
    expect(sessionSecret(storage)).toBe(secret);
    const db = openOfflineDb(SCOPE);
    const vault = await openVault(dexieWrappedKeyStore(db), secret);
    await putCourtDay(db, vault, WS, '2026-10-25', { hello: 'day' }, NOW);
    await putBrief(db, vault, WS, L1, '2026-10-25', { hello: 'brief' }, NOW);
    db.close();
    expect((await readCachedDay(SCOPE, '2026-10-25', storage, NOW))?.value).toEqual({
      hello: 'day',
    });
    expect((await readCachedBrief(SCOPE, L1, storage, NOW))?.value).toEqual({ hello: 'brief' });
    expect(await readCachedDay(SCOPE, '2026-10-26', storage, NOW)).toBeNull();
    // A different session cannot unwrap the key: "no cache".
    expect(await readCachedDay(SCOPE, '2026-10-25', memoryStorage(), NOW)).toBeNull();
  });

  it('remembers the scope of a slug without party data', () => {
    const storage = memoryStorage();
    rememberScope(storage, 'acme', SCOPE);
    expect(recallScope(storage, 'acme')).toEqual(SCOPE);
    expect(recallScope(storage, 'other')).toBeNull();
  });

  it('registers Background Sync only where the browser has it', async () => {
    const tags: string[] = [];
    expect(await registerPrefetchSync({})).toBe(false);
    expect(
      await registerPrefetchSync({
        sync: {
          register: (tag) => {
            tags.push(tag);
            return Promise.resolve();
          },
        },
      }),
    ).toBe(true);
    expect(tags).toEqual(['causedeck-court-day-prefetch']);
  });
});

describe('selectDocumentsToCache (#65)', () => {
  const MB = 1024 * 1024;
  const docs = [
    { documentId: 'd1', matterId: 'saved', date: '2026-10-30', bytes: 100 * MB },
    { documentId: 'd2', matterId: 'other', date: '2026-10-26', bytes: 30 * MB },
    { documentId: 'd3', matterId: 'other', date: '2026-10-28', bytes: 1 * MB },
    { documentId: 'd4', matterId: 'saved', date: '2026-10-29', bytes: 60 * MB },
  ];
  it('takes only saved matters or tomorrow, saved first, within 150 MB', () => {
    const chosen = selectDocumentsToCache(docs, {
      savedMatterIds: new Set(['saved']),
      tomorrow: '2026-10-26',
    });
    expect(chosen.map((d) => d.documentId)).toEqual(['d1', 'd2']);
    expect(chosen.reduce((n, d) => n + d.bytes, 0)).toBeLessThanOrEqual(150 * MB);
  });
});
