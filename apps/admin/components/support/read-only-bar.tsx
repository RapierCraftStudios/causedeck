'use client';
// The read-only support bar (#314, #27 design spec): an unmistakable `--danger-soft` bar fixed to
// the top of the viewport while staff look at a workspace's content, reading
// `SUPPORT SESSION: READ-ONLY` with the countdown. Screen readers hear it when the view opens and
// again at 5 and 1 minutes left (a polite live region with a separate, rarely changing message, so
// the per-second countdown is not read out).
import { ShieldAlert } from 'lucide-react';

import { clockTime, countdown } from './format.ts';
import { useRemaining } from './use-remaining.ts';

const MINUTE = 60_000;

export function announcement(remainingMs: number, until: string): string {
  if (remainingMs <= 0) return 'Support session ended.';
  if (remainingMs <= MINUTE) return `Support session, read-only: less than 1 minute left.`;
  if (remainingMs <= 5 * MINUTE) return `Support session, read-only: 5 minutes or less left.`;
  return `Support session, read-only, until ${until}. You cannot change anything.`;
}

export function ReadOnlyBar({
  workspaceName,
  expiresAt,
}: {
  workspaceName: string;
  expiresAt: string;
}) {
  const remaining = useRemaining(expiresAt);
  const until = clockTime(new Date(expiresAt));
  return (
    <div
      data-slot="support-read-only-bar"
      className="border-danger bg-danger-soft text-danger fixed inset-x-0 top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 px-4 py-2 text-sm font-semibold"
    >
      <ShieldAlert aria-hidden className="size-4 shrink-0" />
      <span aria-hidden className="tracking-wide">
        SUPPORT SESSION: READ-ONLY
      </span>
      <span aria-hidden className="text-ink min-w-0 truncate font-normal">
        {workspaceName}
      </span>
      <time
        aria-hidden
        dateTime={expiresAt}
        className="text-ink ml-auto font-mono font-normal tabular-nums"
      >
        {countdown(remaining)}
      </time>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement(remaining, until)}
      </span>
    </div>
  );
}
