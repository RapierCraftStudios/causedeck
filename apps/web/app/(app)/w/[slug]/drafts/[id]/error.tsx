'use client';

import { ErrorState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../../lib/report-error.ts';

interface DraftErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Studio error boundary (#827): the message is fixed copy, never the error's own text. */
export default function DraftError({ error, reset }: DraftErrorProps) {
  const t = useTranslations('drafting.states');

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  return (
    <ErrorState
      data-pattern-state="error"
      title={t('error')}
      onRetry={reset}
      labels={{ retry: t('retry') }}
    />
  );
}
