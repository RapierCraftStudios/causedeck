'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

const ROWS = 6;

/** Portfolio loading (#666): the header, the summary cards and case rows as skeletons. */
export default function PortfolioLoading() {
  const t = useTranslations('portfolio');
  return (
    <SkeletonGroup
      data-slot="portfolio-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
      {Array.from({ length: ROWS }, (_, i) => (
        <div key={i} data-portfolio-skeleton-row="" className="flex gap-4">
          <Skeleton className="h-5 flex-1" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
