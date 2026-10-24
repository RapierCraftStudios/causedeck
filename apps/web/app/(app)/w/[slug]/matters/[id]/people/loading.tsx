'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/**
 * People tab loading (#393): the heading with `Add person`, then two role groups of person rows
 * (name, kind badge, other names), as the final list lays them out. It fades in after 150 ms so a
 * fast load never flashes it; under `prefers-reduced-motion` it appears without the fade.
 */
export default function PeopleLoading() {
  const t = useTranslations('matters.workspace.people');
  return (
    <SkeletonGroup
      data-slot="people-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="motion-safe:animate-fade-in gap-4 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:both]"
    >
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-9 w-32" />
      </div>
      {Array.from({ length: 2 }, (_, group) => (
        <div key={group} className="border-line flex flex-col gap-3 rounded-lg border px-4 py-3">
          <Skeleton className="h-4 w-24" />
          {Array.from({ length: 2 }, (_, row) => (
            <div key={row} className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-4 w-56" />
            </div>
          ))}
        </div>
      ))}
    </SkeletonGroup>
  );
}
