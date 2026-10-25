'use client';

// Starts the 7-day prefetch for the workspace the member is in (#65 part 3): once after the shell
// mounts while online, again when the connection returns and when the service worker's Background
// Sync asks a page to (the worker has no session secret). Renders nothing. The store, crypto and
// prefetch code load on demand so they stay out of the workspace shell's initial JS (bundle budget).
// The page-load run waits PREFETCH_DELAY_MS so it never competes with the page the member opened,
// and is skipped when the last sync is fresher than PREFETCH_MIN_AGE_MS: the pull builds seven
// court days and their briefs, and repeating it on every hard load stalled the server (#556).
// Reconnecting and the worker's Background Sync still run it at once.
import { useEffect } from 'react';

import { PREFETCH_MESSAGE } from '../../sw/court-day-cache.ts';

export const PREFETCH_DELAY_MS = 10_000;
export const PREFETCH_MIN_AGE_MS = 30 * 60_000;

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
    const run = async (onPageLoad = false) => {
      if (running || !navigator.onLine) return;
      running = true;
      try {
        const [{ openScope, prefetchWindow, rememberScope }, { pullCourtDaySnapshotAction }] =
          await Promise.all([
            import('../../lib/offline/prefetch.ts'),
            import('../../app/(app)/w/[slug]/_offline/actions.ts'),
          ]);
        rememberScope(localStorage, slug, scope);
        const opened = await openScope(scope, sessionStorage);
        if (!opened) return;
        try {
          if (onPageLoad) {
            const last = await opened.db.meta.get('lastSyncAt');
            if (last && 'value' in last && Date.now() - last.value < PREFETCH_MIN_AGE_MS) return;
          }
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
    const initial = window.setTimeout(() => void run(true), PREFETCH_DELAY_MS);
    const onOnline = () => void run();
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: unknown } | null)?.type === PREFETCH_MESSAGE) void run();
    };
    window.addEventListener('online', onOnline);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onMessage);
      void navigator.serviceWorker.ready
        .then(async (registration) => {
          const { registerPrefetchSync } = await import('../../lib/offline/prefetch.ts');
          return registerPrefetchSync(registration);
        })
        .catch(() => undefined);
    }
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener('online', onOnline);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onMessage);
      }
    };
  }, [slug, userId, workspaceId]);
  return null;
}
