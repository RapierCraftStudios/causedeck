'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/** WhatsApp import loading (#527): the title and the first step's card. */
export default function WhatsAppImportLoading() {
  const t = useTranslations('inbox');
  return (
    <SkeletonGroup
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="max-w-3xl gap-4"
    >
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-32 w-full" />
    </SkeletonGroup>
  );
}
