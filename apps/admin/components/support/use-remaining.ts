'use client';
// Milliseconds left until `expiresAt`, ticking once a second (#314). At zero it refreshes the
// route once, so the server re-reads the session and drops the read-only view.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export function useRemaining(expiresAt: string): number {
  const router = useRouter();
  const end = new Date(expiresAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  const remaining = Math.max(0, end - now);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (remaining === 0) router.refresh();
  }, [remaining, router]);

  return remaining;
}
