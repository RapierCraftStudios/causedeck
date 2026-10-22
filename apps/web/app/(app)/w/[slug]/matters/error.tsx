'use client';

import { ErrorState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../lib/report-error.ts';

interface MattersErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Matters route error boundary (#388): `Couldn't load matters.`, `Retry` and the reference id of
 * the failure (the digest), never the error's message.
 */
export default function MattersError({ error, reset }: MattersErrorProps) {
  const t = useTranslations('matters');

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  return (
    <div data-route="matters" className="flex flex-col gap-6">
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
