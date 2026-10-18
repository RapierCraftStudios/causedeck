'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

const ROWS = 4;

/** Loading placeholder matching a placeholder page: title, description, then list rows. */
export function RouteSkeleton() {
  const t = useTranslations('shell');
  return (
    <SkeletonGroup
      data-slot="route-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-72" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: ROWS }, (_, i) => (
          <div key={i} className="border-line flex items-center gap-3 border-b py-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
