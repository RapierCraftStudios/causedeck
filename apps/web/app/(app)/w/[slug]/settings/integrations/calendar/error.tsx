'use client';

// Calendar error state (#53): `Could not load the calendar settings.` with `Try again` (a fresh
// server render, or the route boundary's `reset`). The boundary reports the error and never shows
// its message.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../../../lib/report-error.ts';

export function CalendarError({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations('calendar.error');
  const router = useRouter();
  return (
    <Alert
      tone="danger"
      data-pattern-state="error"
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (onRetry) onRetry();
            else router.refresh();
          }}
        >
          {t('retry')}
        </Button>
      }
    >
      {t('title')}
    </Alert>
  );
}

interface CalendarErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function CalendarErrorBoundary({ error, reset }: CalendarErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);
  return <CalendarError onRetry={reset} />;
}
