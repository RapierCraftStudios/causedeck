'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

const ROWS = 5;

/** People loading (#848): the header, the search row and contact cards as skeletons. */
export default function PeopleLoading() {
  const t = useTranslations('people');
  return (
    <SkeletonGroup
      data-slot="people-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      <Skeleton className="h-9 w-full max-w-sm" />
      {Array.from({ length: ROWS }, (_, i) => (
        <Skeleton key={i} data-people-skeleton-row="" className="h-20 w-full" />
      ))}
    </SkeletonGroup>
  );
}
