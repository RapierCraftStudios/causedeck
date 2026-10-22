'use client';

import { ProposalCardSkeleton } from '@causedeck/ui/patterns';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/**
 * Inbox loading (#48): the header, the segmented control and skeleton cards with the final card's
 * geometry (header, quote area, action row). It fades in after 150 ms so a fast load never flashes
 * it; under `prefers-reduced-motion` it appears without the fade.
 */
export default function InboxLoading() {
  const t = useTranslations('inbox');
  return (
    <SkeletonGroup
      data-slot="inbox-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="motion-safe:animate-fade-in gap-4 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:both]"
    >
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-11 w-full" />
      <div className="grid gap-3">
        {[0, 1, 2].map((row) => (
          <ProposalCardSkeleton key={row} />
        ))}
      </div>
    </SkeletonGroup>
  );
}
