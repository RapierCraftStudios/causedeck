'use client';
// The matters-list attention badge (#70), loaded on demand. Its flags come from
// `listAttentionAction` after the list renders, so detection (which reads every matter) stays off
// the page's server render. The popover, the flag list and the snooze form stay out of the matters
// route's initial JS (its budget is 25 KB gzip); the badge appears once its chunk and its flags
// arrive, which is after the list itself is usable. With no flags it shows nothing.
import type { AttentionFlag } from '@causedeck/validators/attention';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

import { listAttentionAction } from './attention-actions.ts';

const AttentionBadgeBody = dynamic(
  () => import('./attention-badge-body.tsx').then((m) => m.AttentionBadgeBody),
  { ssr: false },
);

export interface AttentionBadgeProps {
  workspaceId: string;
  canWrite: boolean;
}

export function AttentionBadge({ workspaceId, canWrite }: AttentionBadgeProps) {
  const [flags, setFlags] = useState<readonly AttentionFlag[]>([]);
  // Bumped after a snooze or dismiss, so the badge reloads what is still flagged.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const unmounted = new AbortController();
    // A failed read shows no badge, never an error: the list is the page.
    void listAttentionAction({ workspaceId })
      .then((result) => {
        if (!unmounted.signal.aborted && result.ok) setFlags(result.data);
      })
      .catch(() => undefined);
    return () => {
      unmounted.abort();
    };
  }, [workspaceId, version]);

  if (flags.length === 0) return null;
  return (
    <AttentionBadgeBody
      workspaceId={workspaceId}
      flags={flags}
      canWrite={canWrite}
      onChanged={() => {
        setVersion((v) => v + 1);
      }}
    />
  );
}
