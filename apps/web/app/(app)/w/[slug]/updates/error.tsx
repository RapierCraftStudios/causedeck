'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { ErrorState } from '@causedeck/ui/patterns';

import { reportError } from '../../../../../lib/report-error.ts';

interface DraftsErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Drafts route error boundary (#736): `Retry` and the reference id, never the message. */
export default function DraftsError({ error, reset }: DraftsErrorProps) {
  const t = useTranslations('outward');

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  return (
    <div data-route="updates" className="flex flex-col gap-6">
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
