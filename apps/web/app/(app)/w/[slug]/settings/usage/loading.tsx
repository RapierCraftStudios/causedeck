'use client';

// Usage loading state (#223): skeleton meter cards in the page's grid, then skeleton breakdown rows.
// The route's `loading.tsx` and the page's Suspense fallback.
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

export function UsageSkeleton() {
  const t = useTranslations('usage');
  return (
    <SkeletonGroup
      data-slot="usage-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-6"
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            data-slot="usage-skeleton-meter"
            className="border-line flex flex-col gap-3 rounded-lg border p-4"
          >
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-1 w-full" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
      <div className="flex flex-col">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            data-slot="usage-skeleton-row"
            className="border-line flex items-center gap-4 border-b py-3"
          >
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ml-auto h-4 w-20" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

export default function UsageLoading() {
  return <UsageSkeleton />;
}
