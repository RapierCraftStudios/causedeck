'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/**
 * Proceedings tab loading (#392): the heading, the toolbar and four tree rows, the second nested
 * in the child group's rail, each with its toggle, case number and badges, forum, next date, chips
 * and action column in the final layout. It fades in after
 * 150 ms so a fast load never flashes it; under `prefers-reduced-motion` it appears without the
 * fade.
 */
/** One tree row: toggle, case number with state and stage badges, forum, next date, chips, actions. */
function SkeletonRow() {
  return (
    <div data-proceedings-skeleton="row" className="border-line flex gap-3 border-b py-3">
      <Skeleton className="size-8 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-16" />
        </div>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-48" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-28" />
        </div>
      </div>
      <Skeleton className="size-8 shrink-0" />
    </div>
  );
}

export default function ProceedingsLoading() {
  const t = useTranslations('matters.workspace.proceedingsTab');
  return (
    <SkeletonGroup
      data-slot="proceedings-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="motion-safe:animate-fade-in gap-4 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:both]"
    >
      <Skeleton className="h-4 w-24" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="flex flex-col">
        <SkeletonRow />
        <div className="border-line ms-4 border-s ps-3">
          <SkeletonRow />
        </div>
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </SkeletonGroup>
  );
}
