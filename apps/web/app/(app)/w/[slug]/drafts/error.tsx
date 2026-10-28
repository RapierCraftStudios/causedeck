'use client';

import { Button } from '@causedeck/ui/button';
import { ErrorState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { reportError } from '../../../../../lib/report-error.ts';

interface DraftsErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Drafts route error boundary (#826): translated copy, the request id and `Try again`, never the message. */
export default function DraftsError({ error, reset }: DraftsErrorProps) {
  const t = useTranslations('drafting');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  const digest = error.digest;
  const copyId = () => {
    // `navigator.clipboard` is missing outside secure contexts.
    if (digest === undefined || !('clipboard' in navigator)) return;
    void navigator.clipboard.writeText(digest).then(() => {
      setCopied(true);
    });
  };

  return (
    <div data-route="drafts" className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-medium">{t('list.title')}</h1>
      <ErrorState
        data-pattern-state="error"
        title={t('states.listError')}
        description={digest ? t('states.requestId', { digest }) : undefined}
        onRetry={reset}
        labels={{ retry: t('states.retry') }}
      />
      {digest ? (
        <div>
          <Button variant="ghost" size="sm" onClick={copyId}>
            {copied ? t('states.copied') : t('states.copyId')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
