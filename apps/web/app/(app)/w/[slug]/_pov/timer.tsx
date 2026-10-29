'use client';
// The context test stopwatch (#86). The visible text updates every second but is not a live region;
// the start and finish are announced once each by the flow. Plain text, so reduced motion is moot.
import { useEffect, useState } from 'react';

export function useStopwatch(running: boolean, startedAt: number | null): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [running]);
  return running && startedAt !== null ? Math.max(0, (now || startedAt) - startedAt) : 0;
}
