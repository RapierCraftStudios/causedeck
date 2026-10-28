'use client';

import { MemoryCardSkeleton } from '@causedeck/ui/patterns';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/** Playbooks loading (#903): the header and cards with the final cards' geometry. */
export default function PlaybooksLoading() {
  const t = useTranslations('memoryM5');
  return (
    <SkeletonGroup
      data-slot="memory-playbooks-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="motion-safe:animate-fade-in gap-4 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:both]"
    >
      <Skeleton className="h-8 w-40" />
      <MemoryCardSkeleton />
      <MemoryCardSkeleton />
    </SkeletonGroup>
  );
}
