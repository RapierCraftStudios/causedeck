// Offline confirm queue of the hearing-outcome screen (#730, deferred from #62 R10). Confirming an
// outcome while offline used to park the decision (summary, reason, obligation and task choices) in
// plaintext localStorage. It now waits here, sealed with the outbox's device key (crypto.ts) before
// it touches IndexedDB, and nothing here logs. One row per hearing: a newer confirm replaces the
// older one. A row leaves the queue only after the confirm action accepted it; the action re-checks
// the canonical date, so a replay never overwrites a confirmed outcome (a CONFLICT stays for the
// person). Like draft-edits.ts it works against a small store interface so tests need no
// IndexedDB; Dexie loads only on first use.
import { decryptBytes, encryptBytes, getDeviceKey, type Sealed } from './crypto.ts';
import type { KeyStore } from './db.ts';

export interface QueuedOutcomeConfirm<T = unknown> {
  workspaceId: string;
  hearingId: string;
  /** The confirmation exactly as the confirm action takes it. */
  payload: T;
}

export type OutcomeConfirmState = 'queued' | 'conflict' | 'failed';

interface ConfirmRow extends Sealed {
  id: string;
  workspaceId: string;
  hearingId: string;
  createdAt: number;
  state: OutcomeConfirmState;
}

export interface OutcomeConfirmStore {
  queue(): Promise<ConfirmRow[]>;
  putQueued(row: ConfirmRow): Promise<void>;
  removeQueued(id: string): Promise<void>;
}

const rowId = (workspaceId: string, hearingId: string) => `${workspaceId}:${hearingId}`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  return encryptBytes(key, encoder.encode(JSON.stringify(value)).buffer);
}

async function open<T>(key: CryptoKey, row: Sealed): Promise<T> {
  return JSON.parse(decoder.decode(await decryptBytes(key, row))) as T;
}

/** Queue (or replace) the pending confirm of a hearing. */
export async function queueOutcomeConfirm<T>(
  store: OutcomeConfirmStore,
  keys: KeyStore,
  confirm: QueuedOutcomeConfirm<T>,
  now = Date.now(),
): Promise<void> {
  const sealed = await seal(await getDeviceKey(keys), confirm);
  await store.putQueued({
    id: rowId(confirm.workspaceId, confirm.hearingId),
    workspaceId: confirm.workspaceId,
    hearingId: confirm.hearingId,
    createdAt: now,
    state: 'queued',
    ...sealed,
  });
}

/** How many confirms wait on this device for the given state (default `queued`). */
export async function pendingOutcomeConfirms(
  store: OutcomeConfirmStore,
  workspaceId?: string,
  state: OutcomeConfirmState = 'queued',
): Promise<number> {
  const rows = await store.queue();
  return rows.filter(
    (row) => row.state === state && (workspaceId === undefined || row.workspaceId === workspaceId),
  ).length;
}

export type SendConfirm<T> = (
  confirm: QueuedOutcomeConfirm<T>,
) => Promise<{ ok: true } | { ok: false; code: string }>;

export interface FlushResult {
  sent: number;
  conflicts: number;
  failed: number;
}

/**
 * Send the queued confirms through `send` (the confirm action). A confirmed one leaves the queue; a
 * CONFLICT stays as `conflict` for the person (never overwritten, never retried); FORBIDDEN and
 * NOT_FOUND can never succeed and become `failed`; any other failure, or a thrown error, stays
 * `queued` for the next `online` event. `only` limits the flush to one hearing.
 */
export async function flushOutcomeConfirms<T>(
  store: OutcomeConfirmStore,
  keys: KeyStore,
  send: SendConfirm<T>,
  only?: { workspaceId: string; hearingId: string },
): Promise<FlushResult> {
  const key = await getDeviceKey(keys);
  const result: FlushResult = { sent: 0, conflicts: 0, failed: 0 };
  for (const row of await store.queue()) {
    if (row.state !== 'queued') continue;
    if (only !== undefined && row.id !== rowId(only.workspaceId, only.hearingId)) continue;
    const confirm = await open<QueuedOutcomeConfirm<T>>(key, row).catch(() => undefined);
    if (confirm === undefined) {
      await store.removeQueued(row.id);
      continue;
    }
    let outcome: Awaited<ReturnType<SendConfirm<T>>>;
    try {
      outcome = await send(confirm);
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

/** Drop the queued confirm of a hearing (the person chose to start over). */
export function discardQueuedConfirm(
  store: OutcomeConfirmStore,
  workspaceId: string,
  hearingId: string,
): Promise<void> {
  return store.removeQueued(rowId(workspaceId, hearingId));
}

export interface OutcomeConfirmStores {
  store: OutcomeConfirmStore;
  keys: KeyStore;
}

let stores: Promise<OutcomeConfirmStores> | undefined;

/** Forget the cached stores, so the next call opens fresh connections (after a failed write). */
export function resetOutcomeConfirmStores(): void {
  stores = undefined;
}

/** The IndexedDB-backed store and the outbox's device key store; Dexie loads on first call. */
export function browserOutcomeConfirmStores(): Promise<OutcomeConfirmStores> {
  stores ??= (async () => {
    const { default: Dexie } = await import('dexie');
    const { dexieKeyStore } = await import('./db.ts');
    const db = new Dexie('causedeck-outcome-confirms');
    db.version(1).stores({ queue: 'id, workspaceId, hearingId, state' });
    const queue = db.table<ConfirmRow, string>('queue');
    const store: OutcomeConfirmStore = {
      queue: () => queue.toArray(),
      putQueued: async (row) => {
        await queue.put(row);
      },
      removeQueued: (id) => queue.delete(id),
    };
    return { store, keys: dexieKeyStore() };
  })();
  // A failed load (the chunk could not be fetched) must not stick: the next call tries again.
  stores.catch(() => {
    stores = undefined;
  });
  return stores;
}
