'use client';

// Court watch loading state (#482): a skeleton card.
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

export default function CourtWatchLoading() {
  const t = useTranslations('settings.courtWatch');
  return (
    <SkeletonGroup
      data-slot="court-watch-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-4"
    >
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-24 w-full" />
    </SkeletonGroup>
  );
}
