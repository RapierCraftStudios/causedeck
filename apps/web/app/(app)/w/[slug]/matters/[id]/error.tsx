'use client';

import { ErrorState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../../lib/report-error.ts';

interface MatterErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Matter workspace error boundary (#390): `Couldn't load this matter.`, `Retry` and the reference
 * id of the failure (the digest), never the error's message.
 */
export default function MatterError({ error, reset }: MatterErrorProps) {
  const t = useTranslations('matters.workspace.error');

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  return (
    <div data-route="matter" className="flex flex-col gap-6">
      <ErrorState
        data-pattern-state="error"
        title={t('title')}
        description={
          error.digest === undefined ? undefined : t('reference', { digest: error.digest })
        }
        onRetry={reset}
        labels={{ retry: t('retry') }}
      />
    </div>
  );
}
