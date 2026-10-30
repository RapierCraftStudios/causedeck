'use client';

import { ErrorState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../lib/report-error.ts';

interface OnboardingErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Wizard error boundary (#92): translated copy, `Try again` and the request reference; never the message. */
export default function OnboardingError({ error, reset }: OnboardingErrorProps) {
  const t = useTranslations('onboarding.states.error');

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  return (
    <main id="main" tabIndex={-1} data-route="onboarding" className="mx-auto max-w-xl px-4 py-10">
      <ErrorState
        data-pattern-state="error"
        title={t('title')}
        description={
          error.digest ? `${t('body')} ${t('reference', { digest: error.digest })}` : t('body')
        }
        onRetry={reset}
        labels={{ retry: t('retry') }}
      />
    </main>
  );
}
