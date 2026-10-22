'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

const ROWS = 5;

/** Rosters loading (#435): the header, the forum rail, roster cards and hall rows as skeletons. */
export default function RostersLoading() {
  const t = useTranslations('courtsRosters');
  return (
    <SkeletonGroup
      data-slot="rosters-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="hidden h-9 w-full md:block" />
        </div>
        <div className="flex flex-col gap-3">
          <div className="border-line flex flex-col gap-2 rounded-md border p-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          {Array.from({ length: ROWS }, (_, i) => (
            <div key={i} data-rosters-skeleton-row="" className="flex gap-4">
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-5 flex-1" />
              <Skeleton className="h-5 flex-1" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonGroup>
  );
}
