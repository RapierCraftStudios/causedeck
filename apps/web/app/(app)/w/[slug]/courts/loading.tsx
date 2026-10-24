'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

const CARDS = 6;

/** Courts loading (#399): the header, the search field and a grid of forum card skeletons. */
export default function CourtsLoading() {
  const t = useTranslations('courts');
  return (
    <SkeletonGroup
      data-slot="courts-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <Skeleton className="h-6 w-32" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: CARDS }, (_, i) => (
          <div key={i} className="border-line flex flex-col gap-3 rounded-md border p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <div className="flex gap-1.5">
              <Skeleton className="h-5 w-10" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-14" />
            </div>
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
