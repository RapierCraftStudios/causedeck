'use client';
// The active-session banner on a staff session page (#314): how long the grant has left, live, and
// when it ends (`until 14:30`). A grant is never extended, so there is no control to add time.
import { countdown, clockTime } from './format.ts';
import { useRemaining } from './use-remaining.ts';

export function SessionCountdown({ expiresAt }: { expiresAt: string }) {
  const remaining = useRemaining(expiresAt);
  return (
    <span data-slot="support-countdown">
      Ends in{' '}
      <time dateTime={expiresAt} className="font-mono tabular-nums">
        {countdown(remaining)}
      </time>{' '}
      (until {clockTime(new Date(expiresAt))})
    </span>
  );
}
