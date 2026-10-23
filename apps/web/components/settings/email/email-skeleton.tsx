'use client';
// Email intake loading state (#54): skeleton cards for the channel, address and allow-list.
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

export function EmailIntakeSkeleton() {
  const t = useTranslations('emailIntake');
  return (
    <SkeletonGroup labels={{ loading: t('loading') }} data-pattern-state="loading">
      {[1, 2, 3].map((card) => (
        <div key={card} className="border-line flex flex-col gap-4 rounded-xl border p-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-24" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
