'use client';

import { ErrorState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../lib/report-error.ts';

interface OnboardingErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Onboarding route error boundary (#501): `Retry` and the reference id (the digest), never the message. */
export default function OnboardingError({ error, reset }: OnboardingErrorProps) {
  const t = useTranslations('onboardingDiscovery');

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  return (
    <div data-route="onboarding-discovery" className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <ErrorState
        data-pattern-state="error"
        title={t('error.title')}
        description={
          error.digest === undefined ? undefined : t('error.reference', { digest: error.digest })
        }
        onRetry={reset}
        labels={{ retry: t('error.retry') }}
      />
    </div>
  );
}
