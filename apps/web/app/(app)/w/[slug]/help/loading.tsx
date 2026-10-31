'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

export default function HelpLoading() {
  const t = useTranslations('help');
  return (
    <SkeletonGroup labels={{ loading: t('search.loading') }}>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-4 h-10 w-full" />
      <Skeleton className="mt-3 h-16 w-full" />
    </SkeletonGroup>
  );
}
