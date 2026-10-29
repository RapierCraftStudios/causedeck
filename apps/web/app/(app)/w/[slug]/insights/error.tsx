'use client';

import { ErrorState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../lib/report-error.ts';

interface InsightsErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Insights route error boundary (#85): translated copy and `Retry`, never the message. */
export default function InsightsError({ error, reset }: InsightsErrorProps) {
  const t = useTranslations('insights');

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  return (
    <div data-route="insights" className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <ErrorState
        data-pattern-state="error"
        title={t('error.title')}
        description={error.digest ? t('error.reference', { digest: error.digest }) : undefined}
        onRetry={reset}
        labels={{ retry: t('error.retry') }}
      />
    </div>
  );
}
