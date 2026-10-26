'use client';
// The board's data seam (#59, #65): the server-rendered day in, the day to show out, with the
// connection state. With a `source` it is cache-first: the day saved on this device (encrypted, see
// `lib/offline`) is read at once, the fresh payload replaces it when it arrives and is written back,
// and with no network the saved day is what shows. Without a `source` it passes `fresh` through.
import { useEffect, useState } from 'react';

import type { OfflineScope } from '../../../../../lib/offline/db.ts';
import { readCachedDay, writeCachedDay } from '../../../../../lib/offline/prefetch.ts';

export interface CourtDayData<T> {
  data: T;
  /** The browser has no connection: the data shown is the last known. */
  offline: boolean;
  /** When the data shown was read. */
  readAt: Date | null;
}

/** Which saved day to read and refresh. */
export interface CourtDaySource {
  scope: OfflineScope;
  /** `YYYY-MM-DD`. */
  date: string;
}

export function useCourtDayData<T>(
  fresh: T,
  readAt: Date | null,
  source?: CourtDaySource,
): CourtDayData<T> {
  const [offline, setOffline] = useState(false);
  const [cached, setCached] = useState<{ value: T; savedAt: number } | null>(null);
  const userId = source?.scope.userId;
  const workspaceId = source?.scope.workspaceId;
  const date = source?.date;

  useEffect(() => {
    const sync = () => {
      setOffline(!navigator.onLine);
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  useEffect(() => {
    if (!userId || !workspaceId || !date) return;
    const watch = { live: true };
    const scope = { userId, workspaceId };
    void (async () => {
      if (fresh !== null && fresh !== undefined) {
        // Network revalidation: the server's day is newer than what is saved.
        await writeCachedDay(scope, date, fresh, sessionStorage, Date.now()).catch(() => undefined);
        return;
      }
      const hit = await readCachedDay<T>(scope, date, sessionStorage, Date.now());
      if (watch.live && hit) setCached({ value: hit.value, savedAt: hit.savedAt });
    })();
    return () => {
      watch.live = false;
    };
  }, [userId, workspaceId, date, fresh]);

  const useFresh = fresh !== null && fresh !== undefined;
  return {
    data: useFresh || !cached ? fresh : cached.value,
    offline,
    readAt: useFresh || !cached ? readAt : new Date(cached.savedAt),
  };
}
