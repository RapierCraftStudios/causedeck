'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

const ROWS = 8;

/**
 * Matters loading (#388): the header, the search and filter row, then skeleton rows shaped like
 * the table's columns (>= 768 px) or the cards (phones). It fades in after 150 ms so a fast load
 * never flashes it; under `prefers-reduced-motion` it appears without the fade.
 */
export default function MattersLoading() {
  const t = useTranslations('matters');
  return (
    <SkeletonGroup
      data-slot="matters-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="motion-safe:animate-fade-in gap-6 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:both]"
    >
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="flex gap-3 max-md:hidden">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div data-matters-skeleton="table" className="flex flex-col max-md:hidden">
        {Array.from({ length: ROWS }, (_, i) => (
          <div
            key={i}
            className="border-line grid grid-cols-[3fr_2fr_2fr_1fr_1.5fr_1.5fr] items-center gap-4 border-b py-3"
          >
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="h-4 w-6 justify-self-end" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
      <div data-matters-skeleton="cards" className="flex flex-col gap-3 md:hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="border-line flex flex-col gap-2 rounded-md border p-4">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Skeleton className="h-3 w-1/2" />
            <div className="flex gap-1.5">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
