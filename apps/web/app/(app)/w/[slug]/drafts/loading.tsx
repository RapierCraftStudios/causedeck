'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

const ROWS = 4;

/** Drafts loading (#826): the header and a stack of draft row skeletons. */
export default function DraftsLoading() {
  const t = useTranslations('drafting.list');
  return (
    <SkeletonGroup
      data-slot="drafts-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      {Array.from({ length: ROWS }, (_, i) => (
        <div key={i} className="border-line flex flex-col gap-2 rounded-lg border p-4">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-5 w-40" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
