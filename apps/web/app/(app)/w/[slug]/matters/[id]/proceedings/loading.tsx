'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/**
 * Proceedings tab loading (#392): the toolbar and three or four tree rows, the second indented as
 * a child, each with its case number, chips and next date in the final layout. It fades in after
 * 150 ms so a fast load never flashes it; under `prefers-reduced-motion` it appears without the
 * fade.
 */
export default function ProceedingsLoading() {
  const t = useTranslations('matters.workspace.proceedingsTab');
  return (
    <SkeletonGroup
      data-slot="proceedings-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="motion-safe:animate-fade-in gap-4 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:both]"
    >
      <Skeleton className="h-6 w-32" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="flex flex-col">
        {[0, 1, 0, 0].map((indent, i) => (
          <div
            key={i}
            data-proceedings-skeleton="row"
            className={`border-line flex flex-col gap-1.5 border-b py-3 ${indent === 1 ? 'ms-7' : ''}`}
          >
            <div className="flex gap-2">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Skeleton className="h-4 w-40" />
            <div className="flex gap-1.5">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-28" />
            </div>
            <Skeleton className="h-4 w-48" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
