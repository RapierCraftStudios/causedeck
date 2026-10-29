'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/** Wizard loading (#92): the step's title, purpose and a form of three fields as skeletons. */
export default function OnboardingLoading() {
  const t = useTranslations('onboarding.states');
  return (
    <SkeletonGroup
      data-slot="onboarding-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="mx-auto w-full max-w-[35rem] gap-5 px-4 py-6"
    >
      <Skeleton className="h-9 w-3/4" />
      <Skeleton className="h-5 w-full" />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} data-onboarding-skeleton-row="" className="h-11 w-full" />
      ))}
      <Skeleton className="h-11 w-full" />
    </SkeletonGroup>
  );
}
