/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const INTERVAL_MS = 15_000;

/** Re-reads the server proposal while the tab is visible, so an owner sees a delegate's confirmation arrive. */
export function LiveRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [active, router]);
  return null;
}
