'use client';

import { ErrorState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../../../lib/report-error.ts';

interface WhatsAppImportErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** WhatsApp import error boundary (#527): `Retry` and the reference id (the digest), never the message. */
export default function WhatsAppImportError({ error, reset }: WhatsAppImportErrorProps) {
  const t = useTranslations('inbox');

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  return (
    <div data-route="inbox-import-whatsapp" className="flex flex-col gap-6">
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
