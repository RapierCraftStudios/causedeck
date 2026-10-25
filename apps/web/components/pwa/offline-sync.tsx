'use client';

// Starts the 7-day prefetch for the workspace the member is in (#65 part 3): once after the shell
// mounts while online, again when the connection returns and when the service worker's Background
// Sync asks a page to (the worker has no session secret). Renders nothing. The store, crypto and
// prefetch code load on demand so they stay out of the workspace shell's initial JS (bundle budget).
import { useEffect } from 'react';

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
        const [{ openScope, prefetchWindow, rememberScope }, { pullCourtDaySnapshotAction }] =
          await Promise.all([
            import('../../lib/offline/prefetch.ts'),
            import('../../app/(app)/w/[slug]/_offline/actions.ts'),
          ]);
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
        .then(async (registration) => {
          const { registerPrefetchSync } = await import('../../lib/offline/prefetch.ts');
          return registerPrefetchSync(registration);
        })
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
