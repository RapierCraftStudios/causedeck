'use client';

import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/** Onboarding loading (#501): the header and the drop zone's geometry; fades in after 150 ms. */
export default function OnboardingLoading() {
  const t = useTranslations('onboardingDiscovery');
  return (
    <SkeletonGroup
      data-slot="onboarding-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="motion-safe:animate-fade-in gap-4 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:both]"
    >
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-48 w-full" />
    </SkeletonGroup>
  );
}
