'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/**
 * Timeline tab loading (#41): the proceedings tree as an outline (two roots, one indented child,
 * one group chip) beside six event skeletons in the final card shape. It fades in after 150 ms so a
 * fast load never flashes it; under `prefers-reduced-motion` it appears without the fade.
 */
export default function TimelineLoading() {
  const t = useTranslations('matterTimeline');
  return (
    <SkeletonGroup
      data-slot="timeline-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="motion-safe:animate-fade-in gap-4 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:both] xl:grid xl:grid-cols-[340px_minmax(0,1fr)] xl:gap-6"
    >
      <div className="hidden flex-col gap-3 xl:flex">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="ms-4 h-14 w-[calc(100%-1rem)]" />
        <Skeleton className="ms-4 h-11 w-40" />
        <Skeleton className="h-14 w-full" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        {Array.from({ length: 6 }, (_, row) => (
          <div key={row} className="border-line flex flex-col gap-2 rounded-lg border p-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-3/4" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-28" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
