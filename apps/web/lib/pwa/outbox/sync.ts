// Sync triggers for the outbox (#50). Background Sync where the browser has it (the service worker
// runs `syncOutbox` on the `sync` event), plus fallbacks that work everywhere: the `online` event,
// app open and `visibilitychange`. On a data-saver connection (`navigator.connection.saveData`)
// nothing uploads on its own; "Upload now" passes `manual: true`.
import { dexieKeyStore, dexieOutboxStore, type OutboxStore } from './db.ts';
import { getDeviceKey } from './crypto.ts';
import {
  enqueueFiles,
  listItems,
  notifyOutboxChanged,
  type EnqueueOptions,
  type EnqueueResult,
} from './queue.ts';
import { uploadItem, type UploadOutcome } from './uploader.ts';

export const SYNC_TAG = 'causedeck-outbox';
const LOCK_NAME = 'causedeck-outbox-sync';

interface ConnectionLike {
  saveData?: boolean;
}

/** Whether the browser asks apps to save data. */
export function dataSaverOn(nav: unknown = globalThis.navigator): boolean {
  return (nav as { connection?: ConnectionLike } | undefined)?.connection?.saveData === true;
}

export interface SyncOptions {
  /** "Upload now": ignore data saver and any backoff wait. */
  manual?: boolean;
  store?: OutboxStore;
  key?: CryptoKey;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface SyncResult {
  attempted: number;
  outcomes: UploadOutcome[];
  /** Earliest time a backed-off item can run again, if any. */
  nextAt: number | null;
  skippedForDataSaver: boolean;
}

async function runOnce(options: SyncOptions): Promise<SyncResult> {
  const now = options.now ?? Date.now;
  const store = options.store ?? dexieOutboxStore();
  const key = options.key ?? (await getDeviceKey(dexieKeyStore()));
  const outcomes: UploadOutcome[] = [];
  let nextAt: number | null = null;
  for (const item of await listItems(store, now())) {
    if (item.state !== 'queued' || item.hold === true || item.workspaceId === null) continue;
    const wait = item.nextAttemptAt ?? 0;
    if (options.manual !== true && wait > now()) {
      nextAt = nextAt === null ? wait : Math.min(nextAt, wait);
      continue;
    }
    const outcome = await uploadItem(item, {
      store,
      key,
      now,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    outcomes.push(outcome);
    notifyOutboxChanged();
    // Signed out: every other item would get the same answer.
    if (outcome === 'signed-out') break;
  }
  return { attempted: outcomes.length, outcomes, nextAt, skippedForDataSaver: false };
}

/** Upload what is waiting. One run at a time across tabs and the service worker. */
export async function syncOutbox(options: SyncOptions = {}): Promise<SyncResult> {
  if (options.manual !== true && dataSaverOn()) {
    return { attempted: 0, outcomes: [], nextAt: null, skippedForDataSaver: true };
  }
  const locks = Reflect.get(globalThis.navigator, 'locks') as LockManager | undefined;
  if (locks === undefined) return runOnce(options);
  const result = await locks.request(LOCK_NAME, { ifAvailable: true }, (lock: Lock | null) =>
    lock === null ? null : runOnce(options),
  );
  return result ?? { attempted: 0, outcomes: [], nextAt: null, skippedForDataSaver: false };
}

interface SyncRegistration {
  sync?: { register(tag: string): Promise<void> };
}

/** Ask the browser to wake the service worker when connectivity returns. */
export async function requestBackgroundSync(): Promise<boolean> {
  try {
    const registration = (await navigator.serviceWorker.ready) as unknown as SyncRegistration;
    if (registration.sync === undefined) return false;
    await registration.sync.register(SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}

/**
 * Page-side triggers: now (app open), `online`, and the tab becoming visible, plus a timer for the
 * earliest backed-off item. Returns a stop function.
 */
export function startOutboxSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    clearTimeout(timer);
    void syncOutbox().then((result) => {
      if (result.nextAt !== null)
        timer = setTimeout(run, Math.max(1000, result.nextAt - Date.now()));
    });
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') run();
  };
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVisible);
  void requestBackgroundSync();
  run();
  return () => {
    clearTimeout(timer);
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Save picked files in the outbox (the iOS and empty-state "Upload files" path), then upload. */
export async function enqueueAndSync(
  files: readonly File[],
  options: EnqueueOptions,
): Promise<EnqueueResult> {
  const result = await enqueueFiles(
    dexieOutboxStore(),
    await getDeviceKey(dexieKeyStore()),
    files,
    options,
  );
  notifyOutboxChanged();
  void requestBackgroundSync();
  void syncOutbox();
  return result;
}
