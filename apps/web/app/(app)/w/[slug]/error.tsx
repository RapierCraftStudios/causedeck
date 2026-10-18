'use client';

import { Button } from '@causedeck/ui/button';
import { ErrorState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { reportError } from '../../../../lib/report-error.ts';

interface WorkspaceErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Workspace route error boundary. Shows translated copy and the digest, never the message. */
export default function WorkspaceError({ error, reset }: WorkspaceErrorProps) {
  const t = useTranslations('shell.error');
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const digest = error.digest;
  const copyId = () => {
    // `navigator.clipboard` is missing outside secure contexts.
    if (digest === undefined || !('clipboard' in navigator)) return;
    void navigator.clipboard.writeText(digest).then(() => {
      setCopied(true);
    });
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <h1 ref={heading} tabIndex={-1} className="font-serif text-2xl font-medium outline-none">
        {t('title')}
      </h1>
      <ErrorState
        className="w-full max-w-md"
        title={t('description')}
        description={digest ? t('reference', { digest }) : undefined}
        onRetry={reset}
        labels={{ retry: t('retry') }}
      />
      {digest ? (
        <Button variant="ghost" size="sm" onClick={copyId}>
          {copied ? t('copied') : t('copyId')}
        </Button>
      ) : null}
    </div>
  );
}
