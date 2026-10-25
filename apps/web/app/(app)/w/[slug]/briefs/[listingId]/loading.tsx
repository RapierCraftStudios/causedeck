/* eslint-disable unicorn/filename-case -- the route segment `[listingId]` is fixed by the issue's path */
'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/** The sheet's geometry while the brief assembles: masthead and the section blocks on the paper. */
export default function BriefLoading() {
  const t = useTranslations('brief');
  return (
    <SkeletonGroup
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="motion-safe:animate-fade-in border-border mx-auto w-full max-w-[794px] gap-5 border p-10 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:both]"
    >
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-16 w-full" />
    </SkeletonGroup>
  );
}
