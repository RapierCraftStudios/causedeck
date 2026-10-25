'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/**
 * Matter workspace loading (#390): the header (a two-line title, status and owner chips), the tab
 * strip, then the Overview cards in the final grid (one column, two from 768 px, 8/4 from
 * 1280 px). It fades in after 150 ms so a fast load never flashes it; under
 * `prefers-reduced-motion` it appears without the fade.
 */
export default function MatterLoading() {
  const t = useTranslations('matters.workspace');
  return (
    <SkeletonGroup
      data-slot="matter-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="motion-safe:animate-fade-in gap-6 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:both]"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-20 max-xl:hidden" />
        <Skeleton className="h-8 w-3/4" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-28" />
        </div>
      </div>
      <div className="border-line flex gap-3 border-b pb-2">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-20" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12 xl:gap-6">
        <div className="flex flex-col gap-4 xl:col-span-8">
          <div
            data-matter-skeleton="next-date"
            className="border-line flex flex-col gap-3 rounded-lg border p-4"
          >
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-56" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-20" />
            </div>
          </div>
          <div className="border-line flex flex-col gap-2 rounded-lg border p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-5 w-64" />
          </div>
          <div className="border-line flex flex-col gap-2 rounded-lg border p-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
        <div className="flex flex-col gap-4 xl:col-span-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="border-line flex flex-col gap-2 rounded-lg border p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonGroup>
  );
}
