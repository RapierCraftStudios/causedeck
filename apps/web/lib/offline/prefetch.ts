// Rolling 7-day prefetch for the offline cache (#65 part 3). After sign-in a page pulls today and
// the six days after it through the snapshot action, seals each day and brief into the encrypted
// store (`db.ts`), purges what the server says the member may no longer see, and evicts days older
// than yesterday. It also holds the cache-first reads the hooks use and the rule for which documents
// may be kept on the device. The Dexie and crypto work sits behind small injected seams so it is
// unit-tested without a browser.
import type { Brief } from '@causedeck/validators';

import type { Vault } from './crypto.ts';
import {
  type OfflineDb,
  type OfflineScope,
  dexieWrappedKeyStore,
  evictOutsideWindow,
  getBrief,
  getCourtDay,
  openOfflineDb,
  putBrief,
  putCourtDay,
} from './db.ts';
import { openVault } from './crypto.ts';
import { addDays, courtDate } from './freshness.ts';
import { PREFETCH_SYNC_TAG } from '../../sw/court-day-cache.ts';

import type { CourtDaySnapshot, KnownIds } from '../../app/(app)/w/[slug]/_offline/snapshot.ts';

/** Days held offline, today included. */
export const PREFETCH_DAYS = 7;
/** Largest size of documents kept on the device. */
export const DOCUMENT_BUDGET_BYTES = 150 * 1024 * 1024;

export interface PullResult {
  ok: boolean;
  data?: CourtDaySnapshot;
}

export interface PrefetchDeps {
  db: OfflineDb;
  vault: Vault;
  workspaceId: string;
  now: number;
  pull: (input: { from: string; to: string; known: KnownIds }) => Promise<PullResult>;
}

export interface PrefetchSummary {
  days: number;
  briefs: number;
  purged: number;
  evicted: number;
}

/** What the device already holds, so the server can say which of it to purge. */
async function knownIds(db: OfflineDb, vault: Vault): Promise<KnownIds> {
  const rows = await db.briefs.toArray();
  const matterIds = new Set<string>();
  for (const row of rows) {
    try {
      matterIds.add((await vault.open<Brief>(row)).matter_id);
    } catch {
      // An unreadable row is dropped by the next write of the same key; nothing to report.
    }
  }
  return { listingIds: rows.map((r) => r.listingId), matterIds: [...matterIds], memberIds: [] };
}

/** Delete cached briefs the member may no longer see: by listing, or by matter (decrypted). */
async function purgeRevoked(
  db: OfflineDb,
  vault: Vault,
  purge: CourtDaySnapshot['purge'],
): Promise<number> {
  const listings = new Set(purge.listingIds);
  const matters = new Set(purge.matterIds);
  const rows = await db.briefs.toArray();
  const doomed: string[] = [];
  for (const row of rows) {
    if (listings.has(row.listingId)) {
      doomed.push(row.listingId);
      continue;
    }
    if (matters.size === 0) continue;
    try {
      if (matters.has((await vault.open<Brief>(row)).matter_id)) doomed.push(row.listingId);
    } catch {
      doomed.push(row.listingId);
    }
  }
  const byListing = new Map(rows.map((r) => [r.listingId, r.workspaceId]));
  await Promise.all(doomed.map((id) => db.briefs.delete([byListing.get(id) ?? '', id])));
  return doomed.length;
}

/** Pull the rolling window and store it. Rejects nothing the server refused: returns null then. */
export async function prefetchWindow(deps: PrefetchDeps): Promise<PrefetchSummary | null> {
  const { db, vault, workspaceId, now } = deps;
  const today = courtDate(now);
  const from = today;
  const to = addDays(today, PREFETCH_DAYS - 1);
  const result = await deps.pull({ from, to, known: await knownIds(db, vault) });
  if (!result.ok || !result.data) return null;
  const snapshot = result.data;
  const dateOf = new Map<string, string>();
  for (const board of snapshot.days) {
    await putCourtDay(db, vault, workspaceId, board.day.date, board, now);
    for (const complex of board.day.complexes)
      for (const hall of complex.halls)
        for (const list of hall.lists)
          for (const item of list.items) dateOf.set(item.listingId, board.day.date);
  }
  for (const brief of snapshot.briefs) {
    const date = dateOf.get(brief.listing_id) ?? today;
    await putBrief(db, vault, workspaceId, brief.listing_id, date, brief, now);
  }
  const purged = await purgeRevoked(db, vault, snapshot.purge);
  const evicted = await evictOutsideWindow(db, today);
  await db.meta.put({ id: 'lastSyncAt', value: now });
  return { days: snapshot.days.length, briefs: snapshot.briefs.length, purged, evicted };
}

interface SyncRegistrationLike {
  sync?: { register(tag: string): Promise<void> };
}

/** Ask for a Background Sync so the prefetch retries when the connection returns. */
export async function registerPrefetchSync(registration: SyncRegistrationLike): Promise<boolean> {
  if (!registration.sync) return false;
  try {
    await registration.sync.register(PREFETCH_SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}

// --- the session secret and the scope pointer -------------------------------------------------

const SECRET_KEY = 'causedeck-offline-secret';
const SCOPE_PREFIX = 'causedeck-offline-scope:';

/** The secret that exists only for this browser session (ADR 0042): gone with the session. */
export function sessionSecret(storage: Pick<Storage, 'getItem' | 'setItem'>): string {
  const existing = storage.getItem(SECRET_KEY);
  if (existing) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  storage.setItem(SECRET_KEY, secret);
  return secret;
}

/** Ids only, no party data: lets the offline shell find the right database from a URL slug. */
export function rememberScope(
  storage: Pick<Storage, 'setItem'>,
  slug: string,
  scope: OfflineScope,
): void {
  storage.setItem(`${SCOPE_PREFIX}${slug}`, JSON.stringify(scope));
}

export function recallScope(storage: Pick<Storage, 'getItem'>, slug: string): OfflineScope | null {
  try {
    const raw = storage.getItem(`${SCOPE_PREFIX}${slug}`);
    const parsed = raw ? (JSON.parse(raw) as Partial<OfflineScope>) : null;
    return parsed?.userId && parsed.workspaceId
      ? { userId: parsed.userId, workspaceId: parsed.workspaceId }
      : null;
  } catch {
    return null;
  }
}

/** Open this scope's store with the session secret; a failed unwrap means "no cache" (null). */
export async function openScope(
  scope: OfflineScope,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): Promise<{ db: OfflineDb; vault: Vault } | null> {
  const db = openOfflineDb(scope);
  try {
    return { db, vault: await openVault(dexieWrappedKeyStore(db), sessionSecret(storage)) };
  } catch {
    db.close();
    return null;
  }
}

// --- cache-first reads ------------------------------------------------------------------------

export interface Cached<T> {
  value: T;
  savedAt: number;
  stale: boolean;
}

export async function readCachedDay<T>(
  scope: OfflineScope,
  date: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  now: number,
): Promise<Cached<T> | null> {
  const opened = await openScope(scope, storage);
  if (!opened) return null;
  try {
    return ((await getCourtDay(opened.db, opened.vault, scope.workspaceId, date, now)) ??
      null) as Cached<T> | null;
  } catch {
    return null;
  } finally {
    opened.db.close();
  }
}

export async function readCachedBrief(
  scope: OfflineScope,
  listingId: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  now: number,
): Promise<Cached<Brief> | null> {
  const opened = await openScope(scope, storage);
  if (!opened) return null;
  try {
    return ((await getBrief(opened.db, opened.vault, scope.workspaceId, listingId, now)) ??
      null) as Cached<Brief> | null;
  } catch {
    return null;
  } finally {
    opened.db.close();
  }
}

/** Write a freshly rendered day or brief back (network revalidation keeps the cache current). */
export async function writeCachedDay(
  scope: OfflineScope,
  date: string,
  value: unknown,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  now: number,
): Promise<void> {
  const opened = await openScope(scope, storage);
  if (!opened) return;
  try {
    await putCourtDay(opened.db, opened.vault, scope.workspaceId, date, value, now);
  } finally {
    opened.db.close();
  }
}

// --- documents ----------------------------------------------------------------------------------

export interface DocumentCandidate {
  documentId: string;
  matterId: string;
  /** The court day of the listing the document belongs to. */
  date: string;
  bytes: number;
}

/**
 * Which documents may be kept: only those of a matter saved with "Save for offline", or of
 * tomorrow's board, in that order, until the budget is spent. Nothing else is ever selected.
 */
export function selectDocumentsToCache(
  candidates: readonly DocumentCandidate[],
  options: { savedMatterIds: ReadonlySet<string>; tomorrow: string; budgetBytes?: number },
): DocumentCandidate[] {
  const budget = options.budgetBytes ?? DOCUMENT_BUDGET_BYTES;
  const eligible = candidates.filter(
    (c) => options.savedMatterIds.has(c.matterId) || c.date === options.tomorrow,
  );
  eligible.sort(
    (a, b) =>
      Number(options.savedMatterIds.has(b.matterId)) -
      Number(options.savedMatterIds.has(a.matterId)),
  );
  const chosen: DocumentCandidate[] = [];
  let used = 0;
  for (const c of eligible) {
    if (used + c.bytes > budget) continue;
    used += c.bytes;
    chosen.push(c);
  }
  return chosen;
}
