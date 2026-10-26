'use client';

// The client side of the offline outbox (#851): the brief sheet and the outcome form call
// `enqueueOffline` when the member edits without a connection; the shell drains on reconnect
// (`drainScope`, started by `components/pwa/offline-sync.tsx`). The store and crypto code load on
// demand so they stay out of the initial JS (bundle budget). The scope (user + workspace ids) is
// the one the shell remembered for this slug while online; without it nothing can be sealed and
// the caller keeps its previous behaviour (`enqueueOffline` answers false).
import { useCallback, useEffect, useState } from 'react';

import type { Vault } from './crypto.ts';
import type { OfflineDb } from './db.ts';
import type { OutboxEntry, OutboxEdit, DrainSummary, PushBatch } from './sync.ts';

/** Fired on `window` by the shell when a drain finishes, so open screens re-read the stuck entries. */
export const OUTBOX_DRAINED = 'causedeck:outbox-drained';

/** Fired on `window` to ask the shell for a drain now (after a conflict is resolved online). */
export const OUTBOX_DRAIN_REQUEST = 'causedeck:outbox-drain-request';

export interface OutboxStorage {
  local: Pick<Storage, 'getItem'>;
  session: Pick<Storage, 'getItem' | 'setItem'>;
}

const browserStorage = (): OutboxStorage => ({ local: localStorage, session: sessionStorage });

async function withScope<T>(
  slug: string,
  storage: OutboxStorage,
  run: (opened: { db: OfflineDb; vault: Vault }) => Promise<T>,
): Promise<T | null> {
  const { openScope, recallScope } = await import('./prefetch.ts');
  const scope = recallScope(storage.local, slug);
  if (!scope) return null;
  const opened = await openScope(scope, storage.session);
  if (!opened) return null;
  try {
    return await run(opened);
  } finally {
    opened.db.close();
  }
}

/** Seal an edit into this device's outbox. False when there is no open scope (nothing was saved). */
export async function enqueueOffline(
  slug: string,
  workspaceId: string,
  edit: OutboxEdit,
  storage: OutboxStorage = browserStorage(),
): Promise<boolean> {
  try {
    const { enqueueEdit } = await import('./sync.ts');
    const saved = await withScope(slug, storage, (ctx) => enqueueEdit(ctx, workspaceId, edit));
    return saved !== null;
  } catch {
    return false;
  }
}

/** Replay the queue through `push`; null when there is no scope or the store could not be read. */
export async function drainScope(
  slug: string,
  push: PushBatch,
  storage: OutboxStorage = browserStorage(),
): Promise<DrainSummary | null> {
  try {
    const { drainOutbox } = await import('./sync.ts');
    return await withScope(slug, storage, (ctx) => drainOutbox({ ...ctx, push }));
  } catch {
    return null;
  }
}

/** Entries that stopped and need the member: conflict cards and refusals. */
export async function listStuck(
  slug: string,
  storage: OutboxStorage = browserStorage(),
): Promise<OutboxEntry[]> {
  try {
    const { stuckEntries } = await import('./sync.ts');
    return (await withScope(slug, storage, (ctx) => stuckEntries(ctx))) ?? [];
  } catch {
    return [];
  }
}

/**
 * Settle a next-date conflict card: `server` keeps the server's date and drops the edit; `mine`
 * requeues the edit against the server's date now on file, so it is proposed on the next drain.
 */
export async function resolveConflict(
  slug: string,
  entry: OutboxEntry,
  choice: 'server' | 'mine',
  storage: OutboxStorage = browserStorage(),
): Promise<boolean> {
  try {
    const { removeOutbox, updateOutbox } = await import('./db.ts');
    const done = await withScope(slug, storage, async ({ db, vault }) => {
      if (choice === 'server') {
        await removeOutbox(db, entry.key);
        return true;
      }
      const item = {
        ...(entry.item as Record<string, unknown>),
        expectedCanonicalDate: entry.serverDate ?? null,
      };
      const next: OutboxEntry = {
        key: entry.key,
        createdAt: entry.createdAt,
        state: 'pending',
        item,
      };
      await updateOutbox(db, vault, next, Date.now());
      return true;
    });
    return done === true;
  } catch {
    return false;
  }
}

/** For components: `enqueue` bound to the workspace, and the stuck entries (refreshed after a drain). */
export function useOutbox(slug: string, workspaceId: string) {
  const [stuck, setStuck] = useState<OutboxEntry[]>([]);
  const refresh = useCallback(async () => {
    setStuck(await listStuck(slug));
  }, [slug]);
  useEffect(() => {
    let live = true;
    const read = () =>
      void listStuck(slug).then((entries) => {
        if (live) setStuck(entries);
      });
    read();
    window.addEventListener(OUTBOX_DRAINED, read);
    return () => {
      live = false;
      window.removeEventListener(OUTBOX_DRAINED, read);
    };
  }, [slug]);
  const enqueue = useCallback(
    (edit: OutboxEdit) => enqueueOffline(slug, workspaceId, edit),
    [slug, workspaceId],
  );
  const resolve = useCallback(
    async (entry: OutboxEntry, choice: 'server' | 'mine') => {
      const ok = await resolveConflict(slug, entry, choice);
      await refresh();
      if (ok && choice === 'mine') window.dispatchEvent(new Event(OUTBOX_DRAIN_REQUEST));
      return ok;
    },
    [slug, refresh],
  );
  return { enqueue, stuck, refresh, resolve };
}
