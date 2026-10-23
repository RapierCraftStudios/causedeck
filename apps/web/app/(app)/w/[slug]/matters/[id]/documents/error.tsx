'use client';

import { ErrorState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../../../lib/report-error.ts';

interface DocumentsErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Documents tab error boundary (#393): `Couldn't load the documents of this matter.`, `Retry` and the
 * reference id of the failure (the digest), never the error's message. The header and tabs stay.
 */
export default function DocumentsError({ error, reset }: DocumentsErrorProps) {
  const t = useTranslations('matters.workspace.documents.error');

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  return (
    <ErrorState
      data-pattern-state="error"
      data-slot="documents-error"
      title={t('title')}
      description={
        error.digest === undefined ? undefined : t('reference', { digest: error.digest })
      }
      onRetry={reset}
      labels={{ retry: t('retry') }}
    />
  );
}
