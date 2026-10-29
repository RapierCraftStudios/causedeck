'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

const ROWS = 4;

/** Enquiries loading (#874): the header, the notice and the enquiry rows as skeletons. */
export default function EnquiriesLoading() {
  const t = useTranslations('enquiry');
  return (
    <SkeletonGroup
      data-slot="enquiries-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      {Array.from({ length: ROWS }, (_, i) => (
        <Skeleton key={i} data-enquiry-skeleton-row="" className="h-24 w-full" />
      ))}
    </SkeletonGroup>
  );
}
