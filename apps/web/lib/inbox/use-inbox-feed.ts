'use client';
// Keeps the inbox fresh without a full reload (#48). While any capture is processing the page is
// re-rendered by the server (`router.refresh()`, in a transition so the cards on screen stay until
// the new ones arrive) every 10 s; it stops while the tab is hidden or the device is offline, and
// there is no polling at all when nothing is processing. `offline` is also what the cards use to
// switch off decisions.
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useSyncExternalStore, useTransition } from 'react';

/** How often a processing inbox refreshes. */
export const POLL_MS = 10_000;

function subscribe(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  document.addEventListener('visibilitychange', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
    document.removeEventListener('visibilitychange', listener);
  };
}

/** `online|hidden|offline` as one string, so the store snapshot is a primitive. */
const snapshot = (): string =>
  `${navigator.onLine ? 'online' : 'offline'}:${document.hidden ? 'hidden' : 'visible'}`;
const serverSnapshot = (): string => 'online:visible';

export interface InboxFeed {
  offline: boolean;
  /** A refresh is in flight (the old cards stay visible meanwhile). */
  refreshing: boolean;
  refresh: () => void;
}

export function useInboxFeed(processing: number): InboxFeed {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const offline = state.startsWith('offline');
  const live = state === 'online:visible';

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  useEffect(() => {
    if (!live || processing === 0) return undefined;
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [live, processing, refresh]);

  return { offline, refreshing, refresh };
}
