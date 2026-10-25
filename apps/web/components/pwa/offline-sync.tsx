'use client';

// Starts the 7-day prefetch for the workspace the member is in (#65 part 3): once after the shell
// mounts while online, again when the connection returns and when the service worker's Background
// Sync asks a page to (the worker has no session secret). Renders nothing.
import { useEffect } from 'react';

import { pullCourtDaySnapshotAction } from '../../app/(app)/w/[slug]/_offline/actions.ts';
import {
  openScope,
  prefetchWindow,
  registerPrefetchSync,
  rememberScope,
} from '../../lib/offline/prefetch.ts';
import { PREFETCH_MESSAGE } from '../../sw/court-day-cache.ts';

export function OfflineSync({
  slug,
  userId,
  workspaceId,
}: {
  slug: string;
  userId: string;
  workspaceId: string;
}) {
  useEffect(() => {
    const scope = { userId, workspaceId };
    let running = false;
    const run = async () => {
      if (running || !navigator.onLine) return;
      running = true;
      try {
        rememberScope(localStorage, slug, scope);
        const opened = await openScope(scope, sessionStorage);
        if (!opened) return;
        try {
          await prefetchWindow({
            db: opened.db,
            vault: opened.vault,
            workspaceId,
            now: Date.now(),
            pull: async (input) => {
              const result = await pullCourtDaySnapshotAction({ workspaceId, ...input });
              return result.ok ? { ok: true, data: result.data } : { ok: false };
            },
          });
        } finally {
          opened.db.close();
        }
      } catch {
        // Offline or refused: the next trigger tries again; what is saved stays as it was.
      } finally {
        running = false;
      }
    };
    void run();
    const onOnline = () => void run();
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: unknown } | null)?.type === PREFETCH_MESSAGE) void run();
    };
    window.addEventListener('online', onOnline);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onMessage);
      void navigator.serviceWorker.ready
        .then((registration) => registerPrefetchSync(registration as never))
        .catch(() => undefined);
    }
    return () => {
      window.removeEventListener('online', onOnline);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onMessage);
      }
    };
  }, [slug, userId, workspaceId]);
  return null;
}
