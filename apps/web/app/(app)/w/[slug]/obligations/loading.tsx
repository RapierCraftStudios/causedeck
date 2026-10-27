'use client';

import { ObligationRowSkeleton } from '@causedeck/ui/patterns';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/** Obligations loading (#68): the header, the tab strip and rows with the final row's geometry. */
export default function ObligationsLoading() {
  const t = useTranslations('obligations');
  return (
    <SkeletonGroup
      data-slot="obligations-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="motion-safe:animate-fade-in gap-4 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:both]"
    >
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-11 w-full" />
      <ObligationRowSkeleton rows={5} />
    </SkeletonGroup>
  );
}
