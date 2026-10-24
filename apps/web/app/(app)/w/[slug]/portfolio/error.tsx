'use client';

import { ErrorState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../lib/report-error.ts';

interface PortfolioErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Portfolio route error boundary (#666): translated copy and `Try again`, never the message. */
export default function PortfolioError({ error, reset }: PortfolioErrorProps) {
  const t = useTranslations('portfolio');

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  return (
    <div data-route="portfolio" className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <ErrorState
        data-pattern-state="error"
        title={t('error.title')}
        onRetry={reset}
        labels={{ retry: t('error.retry') }}
      />
    </div>
  );
}
