import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import { destroyKey, openVault } from '../../lib/offline/crypto.ts';
import {
  type OfflineDb,
  type OfflineScope,
  dexieWrappedKeyStore,
  deleteAllOfflineDbs,
  deleteOfflineDb,
  evictOutsideWindow,
  getBrief,
  getCourtDay,
  openOfflineDb,
  putBrief,
  putCourtDay,
} from '../../lib/offline/db.ts';
import {
  addDays,
  courtDate,
  evictableDays,
  isInWindow,
  isStale,
  STALE_AFTER_MS,
  windowStart,
} from '../../lib/offline/freshness.ts';

const A: OfflineScope = { userId: 'user-a', workspaceId: 'ws-1' };
const NOW = Date.UTC(2026, 9, 25, 6, 0, 0);
const PARTY = 'Rajeshwari Venkataraman';
const dayPayload = { items: [{ caseTitle: `${PARTY} v. State of Tamil Nadu`, hall: '4' }] };

const opened: OfflineDb[] = [];
async function session(scope: OfflineScope, secret = 'session-secret-1') {
  const db = openOfflineDb(scope);
  opened.push(db);
  const store = dexieWrappedKeyStore(db);
  return { db, store, vault: await openVault(store, secret) };
}

afterEach(async () => {
  for (const db of opened.splice(0)) db.close();
  await deleteAllOfflineDbs();
});

async function rawDump(db: OfflineDb): Promise<string> {
  const tables = [db.courtDay, db.briefs, db.meta];
  const rows = await Promise.all(tables.map((t) => t.toArray()));
  return JSON.stringify(rows, (_k, v: unknown) =>
    v instanceof ArrayBuffer || ArrayBuffer.isView(v)
      ? Array.from(new Uint8Array(v as ArrayBuffer))
      : v,
  );
}

describe('offline store round trip', () => {
  it('stores and reads a court day and a brief with savedAt and staleness', async () => {
    const { db, vault } = await session(A);
    await putCourtDay(db, vault, A.workspaceId, '2026-10-25', dayPayload, NOW);
    await putBrief(db, vault, A.workspaceId, 'listing-1', '2026-10-25', { note: PARTY }, NOW);

    const day = await getCourtDay(db, vault, A.workspaceId, '2026-10-25', NOW);
    expect(day).toEqual({ value: dayPayload, savedAt: NOW, stale: false });
    const brief = await getBrief(db, vault, A.workspaceId, 'listing-1', NOW + STALE_AFTER_MS + 1);
    expect(brief?.value).toEqual({ note: PARTY });
    expect(brief?.stale).toBe(true);
    expect(await getCourtDay(db, vault, A.workspaceId, '2026-10-26', NOW)).toBeUndefined();
  });
});

describe('no plaintext at rest', () => {
  it('keeps party names and case titles out of every stored byte, and the raw key out of meta', async () => {
    const { db, vault } = await session(A);
    await putCourtDay(db, vault, A.workspaceId, '2026-10-25', dayPayload, NOW);
    await putBrief(db, vault, A.workspaceId, 'listing-1', '2026-10-25', { note: PARTY }, NOW);
    const dump = await rawDump(db);
    expect(dump).not.toContain(PARTY);
    expect(dump).not.toContain('Rajeshwari');
    expect(dump).not.toContain('Tamil Nadu');
    expect(dump).not.toContain('session-secret-1');
    // The one meta row is the wrapped key: salt, iv, wrapped; no CryptoKey object, no raw key field.
    const meta = await db.meta.toArray();
    expect(meta).toHaveLength(1);
    expect(Object.keys(meta[0] ?? {}).sort()).toEqual(['id', 'iv', 'salt', 'wrapped']);
  });

  it('uses a different IV for every payload', async () => {
    const { vault } = await session(A);
    const one = await vault.seal({ a: 1 });
    const two = await vault.seal({ a: 1 });
    expect(Array.from(one.iv)).not.toEqual(Array.from(two.iv));
  });
});

describe('isolation', () => {
  it("keeps one user from reading or opening another user's workspace data", async () => {
    const a = await session(A);
    await putCourtDay(a.db, a.vault, A.workspaceId, '2026-10-25', dayPayload, NOW);

    const b = await session({ userId: 'user-b', workspaceId: 'ws-1' }, 'session-secret-b');
    expect(await b.db.courtDay.count()).toBe(0);
    expect(await getCourtDay(b.db, b.vault, 'ws-1', '2026-10-25', NOW)).toBeUndefined();
    // A's data is unchanged.
    expect((await getCourtDay(a.db, a.vault, 'ws-1', '2026-10-25', NOW))?.value).toEqual(
      dayPayload,
    );
  });

  it('keeps workspaces apart for the same user', async () => {
    const a1 = await session(A);
    await putCourtDay(a1.db, a1.vault, 'ws-1', '2026-10-25', dayPayload, NOW);
    const a2 = await session({ userId: 'user-a', workspaceId: 'ws-2' });
    expect(await getCourtDay(a2.db, a2.vault, 'ws-2', '2026-10-25', NOW)).toBeUndefined();
    expect(await getCourtDay(a2.db, a2.vault, 'ws-1', '2026-10-25', NOW)).toBeUndefined();
    expect(await a1.db.courtDay.count()).toBe(1);
  });

  it("cannot unwrap the key with another session's secret", async () => {
    const { store } = await session(A);
    await expect(openVault(store, 'a-different-session')).rejects.toBeDefined();
  });
});

describe('key and data destruction', () => {
  it('makes sealed rows unreadable once the wrapped key is destroyed', async () => {
    const { db, store, vault } = await session(A);
    await putCourtDay(db, vault, A.workspaceId, '2026-10-25', dayPayload, NOW);
    const row = await db.courtDay.get([A.workspaceId, '2026-10-25']);
    if (!row) throw new Error('row was not stored');
    await destroyKey(store);
    expect(await store.get()).toBeUndefined();
    const fresh = await openVault(store, 'session-secret-1');
    await expect(fresh.open(row)).rejects.toBeDefined();
  });

  it('deleteOfflineDb removes one scope; deleteAllOfflineDbs removes every scope', async () => {
    const a = await session(A);
    await putCourtDay(a.db, a.vault, 'ws-1', '2026-10-25', dayPayload, NOW);
    const other: OfflineScope = { userId: 'user-a', workspaceId: 'ws-2' };
    const b = await session(other);
    await putCourtDay(b.db, b.vault, 'ws-2', '2026-10-25', dayPayload, NOW);
    a.db.close();
    await deleteOfflineDb(A);
    expect(await openOfflineDb(A).courtDay.count()).toBe(0);
    expect(await b.db.courtDay.count()).toBe(1);
    b.db.close();
    await deleteAllOfflineDbs();
    expect(await openOfflineDb(other).courtDay.count()).toBe(0);
  });
});

describe('freshness', () => {
  it('computes the court date in Asia/Kolkata and shifts days', () => {
    expect(courtDate(Date.UTC(2026, 9, 24, 20, 0, 0))).toBe('2026-10-25');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('keeps yesterday and later, evicts older days', () => {
    expect(windowStart('2026-10-25')).toBe('2026-10-24');
    expect(isInWindow('2026-10-24', '2026-10-25')).toBe(true);
    expect(isInWindow('2026-10-23', '2026-10-25')).toBe(false);
    expect(evictableDays(['2026-10-22', '2026-10-24', '2026-11-01'], '2026-10-25')).toEqual([
      '2026-10-22',
    ]);
    expect(isStale(NOW, NOW + STALE_AFTER_MS)).toBe(false);
    expect(isStale(NOW, NOW + STALE_AFTER_MS + 1)).toBe(true);
  });

  it('evictOutsideWindow drops old court days and briefs only', async () => {
    const { db, vault } = await session(A);
    for (const date of ['2026-10-22', '2026-10-24', '2026-10-27']) {
      await putCourtDay(db, vault, 'ws-1', date, dayPayload, NOW);
      await putBrief(db, vault, 'ws-1', `l-${date}`, date, { n: 1 }, NOW);
    }
    expect(await evictOutsideWindow(db, '2026-10-25')).toBe(2);
    expect((await db.courtDay.toArray()).map((r) => r.date)).toEqual(['2026-10-24', '2026-10-27']);
    expect(await db.briefs.count()).toBe(2);
  });
});
