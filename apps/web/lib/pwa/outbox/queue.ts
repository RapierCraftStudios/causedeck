// The outbox queue (#50): enqueue, the item state machine and the size cap. It works against an
// `OutboxStore` and a device key passed in, so it runs in the page, in the service worker (share
// target POST) and in unit tests with no IndexedDB. Importing it never loads Dexie.
import { encryptBytes, sha256Hex } from './crypto.ts';
import type { OutboxItem, OutboxState, OutboxStore } from './db.ts';

/** Default cap on bytes waiting on the device (configurable per call). */
export const DEFAULT_CAP_BYTES = 200 * 1024 * 1024;
export const WARN_RATIO = 0.8;
export const MAX_ATTEMPTS = 8;
/** `sent` rows (blob already deleted) are kept this long so the share screen can show them. */
const SENT_TTL_MS = 24 * 60 * 60 * 1000;

export type CapLevel = 'ok' | 'warn' | 'blocked';

export interface CapStatus {
  level: CapLevel;
  usedBytes: number;
  capBytes: number;
}

/** Bytes still on the device: everything not yet sent. */
export function usedBytes(items: readonly OutboxItem[]): number {
  return items.reduce((sum, item) => (item.state === 'sent' ? sum : sum + item.size), 0);
}

/** Warn from 80% of the cap, block when the new bytes would pass 100%. */
export function capStatus(used: number, incoming: number, capBytes = DEFAULT_CAP_BYTES): CapStatus {
  const after = used + incoming;
  const level: CapLevel =
    after > capBytes ? 'blocked' : after >= capBytes * WARN_RATIO ? 'warn' : 'ok';
  return { level, usedBytes: used, capBytes };
}

const TRANSITIONS: Readonly<Record<OutboxState, readonly OutboxState[]>> = {
  queued: ['uploading'],
  uploading: ['queued', 'failed', 'sent'],
  failed: ['queued'],
  sent: [],
};

export function canTransition(from: OutboxState, to: OutboxState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class OutboxCapError extends Error {
  override name = 'OutboxCapError';
  constructor(readonly status: CapStatus) {
    super('The outbox is full');
  }
}

export interface EnqueueOptions {
  workspaceId: string | null;
  channel: 'share' | 'upload';
  batchId?: string | undefined;
  matterHintId?: string | undefined;
  capBytes?: number | undefined;
  now?: number | undefined;
}

export interface EnqueueResult {
  batchId: string;
  items: OutboxItem[];
  cap: CapStatus;
}

/**
 * Encrypt and store `files`, before any network call. Throws `OutboxCapError` (nothing stored)
 * when they would not fit.
 */
export async function enqueueFiles(
  store: OutboxStore,
  key: CryptoKey,
  files: readonly File[],
  options: EnqueueOptions,
): Promise<EnqueueResult> {
  const capBytes = options.capBytes ?? DEFAULT_CAP_BYTES;
  const incoming = files.reduce((sum, file) => sum + file.size, 0);
  const cap = capStatus(usedBytes(await store.all()), incoming, capBytes);
  if (cap.level === 'blocked') throw new OutboxCapError(cap);

  const batchId = options.batchId ?? crypto.randomUUID();
  const createdAt = options.now ?? Date.now();
  const items: OutboxItem[] = [];
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const sealed = await encryptBytes(key, bytes);
    const item: OutboxItem = {
      id: crypto.randomUUID(),
      batchId,
      workspaceId: options.workspaceId,
      channel: options.channel,
      name: file.name === '' ? 'shared-file' : file.name,
      mime: file.type === '' ? 'application/octet-stream' : file.type,
      size: file.size,
      sha256: await sha256Hex(bytes),
      createdAt,
      state: 'queued',
      attempts: 0,
      lastError: null,
      ...sealed,
      ...(options.matterHintId === undefined ? {} : { matterHintId: options.matterHintId }),
    };
    await store.put(item);
    items.push(item);
  }
  return { batchId, items, cap: capStatus(cap.usedBytes, incoming, capBytes) };
}

async function update(
  store: OutboxStore,
  id: string,
  to: OutboxState,
  patch: Partial<OutboxItem> = {},
): Promise<OutboxItem | undefined> {
  const item = await store.get(id);
  if (item === undefined || !canTransition(item.state, to)) return undefined;
  const next = { ...item, ...patch, state: to };
  await store.put(next);
  return next;
}

export const markUploading = (store: OutboxStore, id: string) =>
  update(store, id, 'uploading', { lastError: null });

/** Back to `queued` after a retryable failure, or `failed` once attempts run out. */
export async function markAttemptFailed(
  store: OutboxStore,
  id: string,
  error: string,
  nextAttemptAt: number,
  progress: Partial<OutboxItem> = {},
): Promise<OutboxItem | undefined> {
  const item = await store.get(id);
  if (item === undefined) return undefined;
  const attempts = item.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  return update(store, id, exhausted ? 'failed' : 'queued', {
    ...progress,
    attempts,
    lastError: error,
    nextAttemptAt: exhausted ? undefined : nextAttemptAt,
  });
}

/** A permanent refusal (type, size, forbidden): `failed` now, with the reason. */
export const markFailed = (store: OutboxStore, id: string, error: string) =>
  update(store, id, 'failed', { lastError: error, nextAttemptAt: undefined });

/** Sent: the encrypted bytes leave the device at once; the row stays briefly for the UI. */
export const markSent = (store: OutboxStore, id: string) =>
  update(store, id, 'sent', {
    encryptedBlob: new ArrayBuffer(0),
    lastError: null,
    nextAttemptAt: undefined,
  });

/** The "Retry" action on a failed item. */
export const retryItem = (store: OutboxStore, id: string) =>
  update(store, id, 'queued', { attempts: 0, lastError: null, nextAttemptAt: undefined });

/** Remove an item and its encrypted blob. */
export function removeItem(store: OutboxStore, id: string): Promise<void> {
  return store.remove(id);
}

/** Assign the workspace (and an optional matter hint) to items waiting for one. */
export async function assignWorkspace(
  store: OutboxStore,
  batchId: string,
  workspaceId: string,
  matterHintId?: string,
): Promise<void> {
  for (const item of await store.all()) {
    if (item.batchId !== batchId || item.state === 'sent') continue;
    await store.put({
      ...item,
      workspaceId,
      ...(matterHintId === undefined ? {} : { matterHintId }),
    });
  }
}

/** Items still on the device first, then recent `sent` rows; old `sent` rows are dropped. */
export async function listItems(store: OutboxStore, now = Date.now()): Promise<OutboxItem[]> {
  const rows = await store.all();
  const fresh: OutboxItem[] = [];
  for (const row of rows) {
    if (row.state === 'sent' && now - row.createdAt > SENT_TTL_MS) await store.remove(row.id);
    else fresh.push(row);
  }
  return fresh;
}

export interface OutboxSummary {
  waiting: number;
  uploading: number;
  failed: number;
  total: number;
  /** 1-based position of the item being uploaded, for "Uploading 1 of 3". */
  position: number;
}

export function summarize(items: readonly OutboxItem[]): OutboxSummary {
  const live = items.filter((item) => item.state !== 'sent');
  const uploadingIndex = live.findIndex((item) => item.state === 'uploading');
  return {
    waiting: live.filter((item) => item.state === 'queued').length,
    uploading: live.filter((item) => item.state === 'uploading').length,
    failed: live.filter((item) => item.state === 'failed').length,
    total: live.length,
    position: uploadingIndex + 1,
  };
}

const CHANNEL_NAME = 'causedeck-outbox';

/** Tell every open tab (and the page that opened the share) the outbox changed. */
export function notifyOutboxChanged(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage('changed');
  channel.close();
}

export function onOutboxChanged(listener: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', listener);
  return () => {
    channel.close();
  };
}

/** Back to `queued` without spending an attempt (signed out, data saver): nothing went wrong. */
export const markDeferred = (store: OutboxStore, id: string, reason: string) =>
  update(store, id, 'queued', { lastError: reason });
