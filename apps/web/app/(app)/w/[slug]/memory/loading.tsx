'use client';

import { MemoryCardSkeleton } from '@causedeck/ui/patterns';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/** Memory loading (#73): the header, the tab strip and cards with the final cards' geometry. */
export default function MemoryLoading() {
  const t = useTranslations('memory');
  return (
    <SkeletonGroup
      data-slot="memory-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="motion-safe:animate-fade-in gap-4 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:both]"
    >
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-11 w-full" />
      <MemoryCardSkeleton />
      <MemoryCardSkeleton />
    </SkeletonGroup>
  );
}
