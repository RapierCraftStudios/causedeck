'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

const ROWS = 3;

/** Limitation loading (#941): the header, the notice and the computation cards as skeletons. */
export default function LimitationLoading() {
  const t = useTranslations('limitation');
  return (
    <SkeletonGroup
      data-slot="limitation-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      {Array.from({ length: ROWS }, (_, i) => (
        <Skeleton key={i} data-limitation-skeleton-row="" className="h-28 w-full" />
      ))}
    </SkeletonGroup>
  );
}
