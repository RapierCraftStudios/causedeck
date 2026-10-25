'use client';
// The board's data seam (#59, consumed by #65's offline cache): the server-rendered day in, the day
// to show out, with the connection state. Today it passes the fresh payload through and reports
// `offline` from the browser; #65 swaps the body for its 7-day cache without touching the board.
import { useEffect, useState } from 'react';

export interface CourtDayData<T> {
  data: T;
  /** The browser has no connection: the data shown is the last known. */
  offline: boolean;
  /** When the data shown was read. */
  readAt: Date | null;
}

export function useCourtDayData<T>(fresh: T, readAt: Date | null): CourtDayData<T> {
  const [offline, setOffline] = useState(false);
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
  return { data: fresh, offline, readAt };
}
