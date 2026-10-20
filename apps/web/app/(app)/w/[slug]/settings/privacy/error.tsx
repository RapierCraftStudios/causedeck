'use client';

// Privacy error state (#286): `Could not load the privacy settings.` with `Try again` (a fresh
// server render, or the route boundary's `reset`). The route boundary reports the error and never
// shows its message.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../../lib/report-error.ts';

export function PrivacyError({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations('settings.privacy.error');
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

interface PrivacyErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function PrivacyErrorBoundary({ error, reset }: PrivacyErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);
  return <PrivacyError onRetry={reset} />;
}
