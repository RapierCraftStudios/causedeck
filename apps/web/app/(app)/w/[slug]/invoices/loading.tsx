'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

const ROWS = 3;

/** Fees loading (#871): the header, the notice and the rows as skeletons. */
export default function InvoicesLoading() {
  const t = useTranslations('fees');
  return (
    <SkeletonGroup
      data-slot="fees-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      {Array.from({ length: ROWS }, (_, i) => (
        <Skeleton key={i} data-fees-skeleton-row="" className="h-20 w-full" />
      ))}
    </SkeletonGroup>
  );
}
