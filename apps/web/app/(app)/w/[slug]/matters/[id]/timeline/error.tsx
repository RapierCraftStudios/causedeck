'use client';

import { ErrorState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../../../lib/report-error.ts';

interface TimelineErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Timeline tab error boundary (#41): `Couldn't load the timeline of this matter.`, `Retry` and the
 * reference id of the failure (the digest), never the error's message. The header and tabs stay.
 */
export default function TimelineError({ error, reset }: TimelineErrorProps) {
  const t = useTranslations('matterTimeline.error');

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  return (
    <ErrorState
      data-pattern-state="error"
      data-slot="timeline-error"
      title={t('title')}
      description={
        error.digest === undefined ? undefined : t('reference', { digest: error.digest })
      }
      onRetry={reset}
      labels={{ retry: t('retry') }}
    />
  );
}
