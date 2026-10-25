'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/**
 * Documents tab loading (#393): the heading with the Inbox entry point, then document rows in the
 * final columns (kind, language chip, text status, source, added date). It fades in after 150 ms
 * so a fast load never flashes it; under `prefers-reduced-motion` it appears without the fade.
 */
export default function DocumentsLoading() {
  const t = useTranslations('matters.workspace.documents');
  return (
    <SkeletonGroup
      data-slot="documents-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="motion-safe:animate-fade-in gap-4 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:both]"
    >
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-8 w-64 max-md:hidden" />
      </div>
      <div className="border-line flex flex-col rounded-lg border px-4">
        {Array.from({ length: 5 }, (_, row) => (
          <div
            key={row}
            className="border-line flex flex-col gap-1.5 border-b py-3 last:border-b-0 md:flex-row md:items-center md:justify-between"
          >
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-5 w-36" />
              <div className="flex gap-1.5">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-8" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
