// The offline cache's IndexedDB schema (#65, Dexie, ADR-0042). One database per user and workspace,
// so a second account on the same browser or a workspace switch never reads another's rows. Only
// keys, dates and `savedAt` are in the clear; every payload is sealed by `crypto.ts`. This is the
// only module in `lib/offline` that imports Dexie, so the shell never pays for it.
import Dexie, { type EntityTable } from 'dexie';

import type { SealedPayload, Vault, WrappedKey, WrappedKeyStore } from './crypto.ts';
import { isStale as isStaleAt, stampSavedAt, windowStart } from './freshness.ts';

export interface OfflineScope {
  userId: string;
  workspaceId: string;
}

const DB_PREFIX = 'causedeck-offline';

export function offlineDbName(scope: OfflineScope): string {
  return `${DB_PREFIX}:${scope.userId}:${scope.workspaceId}`;
}

interface SealedRow extends SealedPayload {
  workspaceId: string;
  savedAt: number;
}

/** Keyed `[workspaceId, date]`. */
export interface CourtDayRow extends SealedRow {
  date: string;
}

/** Keyed `[workspaceId, listingId]`; `date` is the listing's day, for eviction. */
export interface BriefRow extends SealedRow {
  listingId: string;
  date: string;
}

/** Keyed `[workspaceId, documentId]`: metadata only, never file bytes. */
export interface DocumentMetaRow extends SealedRow {
  documentId: string;
  listingId: string;
}

/** Writes made offline, waiting to replay (#745). The payload is sealed. */
export interface OutboxRow extends SealedRow {
  id: string;
  createdAt: number;
}

export type MetaRow = ({ id: 'key' } & WrappedKey) | { id: 'lastSyncAt'; value: number };

export class OfflineDb extends Dexie {
  courtDay!: EntityTable<CourtDayRow>;
  briefs!: EntityTable<BriefRow>;
  documentsMeta!: EntityTable<DocumentMetaRow>;
  outbox!: EntityTable<OutboxRow, 'id'>;
  meta!: EntityTable<MetaRow, 'id'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      courtDay: '[workspaceId+date], date',
      briefs: '[workspaceId+listingId], date',
      documentsMeta: '[workspaceId+documentId], listingId',
      outbox: 'id, workspaceId, createdAt',
      meta: 'id',
    });
  }
}

export function openOfflineDb(scope: OfflineScope): OfflineDb {
  return new OfflineDb(offlineDbName(scope));
}

/** The wrapped data key lives in `meta`, next to the rows it protects. */
export function dexieWrappedKeyStore(db: OfflineDb): WrappedKeyStore {
  return {
    get: async () => {
      const row = await db.meta.get('key');
      return row && 'wrapped' in row ? row : undefined;
    },
    put: async (value) => {
      await db.meta.put({ id: 'key', ...value });
    },
    remove: () => db.meta.delete('key'),
  };
}

export async function putCourtDay(
  db: OfflineDb,
  vault: Vault,
  workspaceId: string,
  date: string,
  value: unknown,
  now: number,
): Promise<void> {
  const sealed = await vault.seal(value);
  await db.courtDay.put({ workspaceId, date, savedAt: stampSavedAt(now), ...sealed });
}

export async function getCourtDay(
  db: OfflineDb,
  vault: Vault,
  workspaceId: string,
  date: string,
  now: number,
): Promise<{ value: unknown; savedAt: number; stale: boolean } | undefined> {
  const row = await db.courtDay.get([workspaceId, date]);
  if (!row) return undefined;
  return {
    value: await vault.open(row),
    savedAt: row.savedAt,
    stale: isStaleAt(row.savedAt, now),
  };
}

export async function putBrief(
  db: OfflineDb,
  vault: Vault,
  workspaceId: string,
  listingId: string,
  date: string,
  value: unknown,
  now: number,
): Promise<void> {
  const sealed = await vault.seal(value);
  await db.briefs.put({ workspaceId, listingId, date, savedAt: stampSavedAt(now), ...sealed });
}

export async function getBrief(
  db: OfflineDb,
  vault: Vault,
  workspaceId: string,
  listingId: string,
  now: number,
): Promise<{ value: unknown; savedAt: number; stale: boolean } | undefined> {
  const row = await db.briefs.get([workspaceId, listingId]);
  if (!row) return undefined;
  return {
    value: await vault.open(row),
    savedAt: row.savedAt,
    stale: isStaleAt(row.savedAt, now),
  };
}

/** Rolling window: drop court days and briefs dated before yesterday. Returns how many rows went. */
export async function evictOutsideWindow(db: OfflineDb, today: string): Promise<number> {
  const cutoff = windowStart(today);
  const days = await db.courtDay.where('date').below(cutoff).delete();
  const briefs = await db.briefs.where('date').below(cutoff).delete();
  return days + briefs;
}

/** Delete this scope's whole database: rows, wrapped key and all (sign-out, switch, clear). */
export async function deleteOfflineDb(scope: OfflineScope): Promise<void> {
  await Dexie.delete(offlineDbName(scope));
}

/** Delete every offline database of this browser (sign-out clears all workspaces and users). */
export async function deleteAllOfflineDbs(): Promise<void> {
  const names = await Dexie.getDatabaseNames();
  await Promise.all(
    names.filter((name) => name.startsWith(`${DB_PREFIX}:`)).map((n) => Dexie.delete(n)),
  );
}
