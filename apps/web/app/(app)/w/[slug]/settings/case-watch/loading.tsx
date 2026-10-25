'use client';

// Case-status watch loading state (#593): a skeleton card.
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

export default function CaseWatchLoading() {
  const t = useTranslations('caseWatch');
  return (
    <SkeletonGroup
      data-slot="case-watch-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-4"
    >
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-24 w-full" />
    </SkeletonGroup>
  );
}
