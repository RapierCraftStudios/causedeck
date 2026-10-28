// Offline support for the drafting studio (#827): the last loaded draft is cached for read-only
// viewing, and edits made offline wait here until `online`, then go through the save action.
// Draft text is privileged, so both the cache and the queue are sealed with the outbox's device key
// (crypto.ts) before they touch IndexedDB, and nothing here logs. One queued row per draft: a newer
// edit replaces the older one, because each holds the whole block tree. Like the outbox, it works
// against a small store interface so tests need no IndexedDB; Dexie loads only on first use.
import type { Block } from '@causedeck/validators/drafting';

import { decryptBytes, encryptBytes, getDeviceKey, type Sealed } from './crypto.ts';
import type { KeyStore } from './db.ts';

export interface DraftSnapshot {
  workspaceId: string;
  draftId: string;
  title: string;
  versionNo: number;
  blocks: Block[];
}

export interface QueuedDraftEdit {
  workspaceId: string;
  draftId: string;
  /** The version the edit started from; the save action refuses a newer head. */
  baseVersionNo: number;
  blocks: Block[];
  /** Edits of AI-drafted text, kept with the queued save. */
  diffs: { blockKey: string; before: string; after: string }[];
}

export type DraftEditState = 'queued' | 'conflict' | 'failed';

interface SealedRow extends Sealed {
  id: string;
  workspaceId: string;
  createdAt: number;
}

interface QueueRow extends SealedRow {
  state: DraftEditState;
}

export interface DraftEditStore {
  getCache(id: string): Promise<SealedRow | undefined>;
  putCache(row: SealedRow): Promise<void>;
  queue(): Promise<QueueRow[]>;
  getQueued(id: string): Promise<QueueRow | undefined>;
  putQueued(row: QueueRow): Promise<void>;
  removeQueued(id: string): Promise<void>;
}

const rowId = (workspaceId: string, draftId: string) => `${workspaceId}:${draftId}`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  return encryptBytes(key, encoder.encode(JSON.stringify(value)).buffer);
}

async function open<T>(key: CryptoKey, row: Sealed): Promise<T> {
  return JSON.parse(decoder.decode(await decryptBytes(key, row))) as T;
}

export async function cacheDraft(
  store: DraftEditStore,
  keys: KeyStore,
  snapshot: DraftSnapshot,
  now = Date.now(),
): Promise<void> {
  const sealed = await seal(await getDeviceKey(keys), snapshot);
  await store.putCache({
    id: rowId(snapshot.workspaceId, snapshot.draftId),
    workspaceId: snapshot.workspaceId,
    createdAt: now,
    ...sealed,
  });
}

/** The cached copy, or `undefined` when there is none or it cannot be opened. */
export async function readCachedDraft(
  store: DraftEditStore,
  keys: KeyStore,
  workspaceId: string,
  draftId: string,
): Promise<DraftSnapshot | undefined> {
  const row = await store.getCache(rowId(workspaceId, draftId));
  if (row === undefined) return undefined;
  try {
    return await open<DraftSnapshot>(await getDeviceKey(keys), row);
  } catch {
    return undefined;
  }
}

/** Queue (or replace) the pending edit of a draft; keeps the oldest base version. */
export async function queueDraftEdit(
  store: DraftEditStore,
  keys: KeyStore,
  edit: QueuedDraftEdit,
  now = Date.now(),
): Promise<void> {
  const key = await getDeviceKey(keys);
  const id = rowId(edit.workspaceId, edit.draftId);
  const previous = await store.getQueued(id);
  let base = edit.baseVersionNo;
  let diffs = edit.diffs;
  if (previous !== undefined) {
    const earlier = await open<QueuedDraftEdit>(key, previous).catch(() => undefined);
    if (earlier !== undefined) {
      base = Math.min(base, earlier.baseVersionNo);
      diffs = [...earlier.diffs, ...diffs];
    }
  }
  const sealed = await seal(key, { ...edit, baseVersionNo: base, diffs });
  await store.putQueued({
    id,
    workspaceId: edit.workspaceId,
    createdAt: now,
    state: 'queued',
    ...sealed,
  });
}

/** How many drafts have changes waiting on this device (all workspaces, or one). */
export async function pendingDraftEdits(
  store: DraftEditStore,
  workspaceId?: string,
): Promise<number> {
  const rows = await store.queue();
  return rows.filter(
    (row) =>
      row.state === 'queued' && (workspaceId === undefined || row.workspaceId === workspaceId),
  ).length;
}

export type SaveEdit = (
  edit: QueuedDraftEdit,
) => Promise<{ ok: true } | { ok: false; code: string }>;

export interface FlushResult {
  sent: number;
  conflicts: number;
  failed: number;
}

/**
 * Send every queued edit through `save` (the save action). A saved edit leaves the queue; a
 * CONFLICT stays as `conflict` for the person to resolve (never overwritten); other failures stay
 * `queued` for the next `online` event, except FORBIDDEN and NOT_FOUND, which can never succeed.
 */
export async function flushDraftEdits(
  store: DraftEditStore,
  keys: KeyStore,
  save: SaveEdit,
): Promise<FlushResult> {
  const key = await getDeviceKey(keys);
  const result: FlushResult = { sent: 0, conflicts: 0, failed: 0 };
  for (const row of await store.queue()) {
    if (row.state !== 'queued') continue;
    const edit = await open<QueuedDraftEdit>(key, row).catch(() => undefined);
    if (edit === undefined) {
      await store.removeQueued(row.id);
      continue;
    }
    let outcome: Awaited<ReturnType<SaveEdit>>;
    try {
      outcome = await save(edit);
    } catch {
      result.failed++;
      continue;
    }
    if (outcome.ok) {
      await store.removeQueued(row.id);
      result.sent++;
    } else if (outcome.code === 'CONFLICT') {
      await store.putQueued({ ...row, state: 'conflict' });
      result.conflicts++;
    } else if (outcome.code === 'FORBIDDEN' || outcome.code === 'NOT_FOUND') {
      await store.putQueued({ ...row, state: 'failed' });
      result.failed++;
    } else {
      result.failed++;
    }
  }
  return result;
}

/** Drop the queued edit of a draft (the person chose to reload the saved version). */
export function discardQueuedEdit(
  store: DraftEditStore,
  workspaceId: string,
  draftId: string,
): Promise<void> {
  return store.removeQueued(rowId(workspaceId, draftId));
}

export interface DraftEditStores {
  store: DraftEditStore;
  keys: KeyStore;
}

let stores: Promise<DraftEditStores> | undefined;

/** The IndexedDB-backed store and the outbox's device key store; Dexie loads on first call. */
export function browserDraftEditStores(): Promise<DraftEditStores> {
  stores ??= (async () => {
    const { default: Dexie } = await import('dexie');
    const { dexieKeyStore } = await import('./db.ts');
    const db = new Dexie('causedeck-draft-edits');
    db.version(1).stores({ cache: 'id, workspaceId', queue: 'id, workspaceId, state' });
    const cache = db.table<SealedRow, string>('cache');
    const queue = db.table<QueueRow, string>('queue');
    const store: DraftEditStore = {
      getCache: (id) => cache.get(id),
      putCache: async (row) => {
        await cache.put(row);
      },
      queue: () => queue.toArray(),
      getQueued: (id) => queue.get(id),
      putQueued: async (row) => {
        await queue.put(row);
      },
      removeQueued: (id) => queue.delete(id),
    };
    return { store, keys: dexieKeyStore() };
  })();
  return stores;
}
