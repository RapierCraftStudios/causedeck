'use client';

import { ErrorState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../../lib/report-error.ts';

interface ContactErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Contact route error boundary (#848): translated copy and `Retry`, never the message. */
export default function ContactError({ error, reset }: ContactErrorProps) {
  const t = useTranslations('people');

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  return (
    <div data-route="people" className="flex flex-col gap-6">
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
