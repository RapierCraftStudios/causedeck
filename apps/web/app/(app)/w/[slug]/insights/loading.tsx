'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

const TILES = 3;

/** Insights loading (#85): the header, the range picker, the hero and the tiles as skeletons. */
export default function InsightsLoading() {
  const t = useTranslations('insights');
  return (
    <SkeletonGroup
      data-slot="insights-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      <Skeleton className="h-11 w-56" />
      <Skeleton className="h-56 w-full" />
      {Array.from({ length: TILES }, (_, i) => (
        <Skeleton key={i} data-insights-skeleton-tile="" className="h-32 w-full" />
      ))}
    </SkeletonGroup>
  );
}
