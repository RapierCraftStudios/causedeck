'use client';

// Danger loading state (#288): a skeleton in the shape of the danger zone card, never a spinner-only screen.
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

export default function DangerLoading() {
  const t = useTranslations('settings.danger');
  return (
    <SkeletonGroup
      data-slot="danger-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="border-line flex flex-col gap-3 rounded-xl border p-4">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-9 w-40 self-end" />
      </div>
    </SkeletonGroup>
  );
}
