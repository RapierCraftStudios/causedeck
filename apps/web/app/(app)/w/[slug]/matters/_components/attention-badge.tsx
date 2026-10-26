'use client';
// The matters-list attention badge (#70), loaded on demand. The popover, the flag list and the
// snooze form stay out of the matters route's initial JS (its budget is 25 KB gzip); the badge
// appears once its chunk arrives, which is after the list itself is usable.
import dynamic from 'next/dynamic';

import type { AttentionBadgeProps } from './attention-badge-body.tsx';

const AttentionBadgeBody = dynamic(
  () => import('./attention-badge-body.tsx').then((m) => m.AttentionBadgeBody),
  { ssr: false },
);

export function AttentionBadge(props: AttentionBadgeProps) {
  return <AttentionBadgeBody {...props} />;
}
