'use client';

// Account error state (#289): `Could not load your account.` with `Try again` (a fresh server
// render, or the route boundary's `reset`). Each account section shows it inline when its own data
// fails to load; the route boundary reports the error and never shows its message.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../lib/report-error.ts';

export function AccountError({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations('settings.account.error');
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

interface AccountErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AccountErrorBoundary({ error, reset }: AccountErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);
  return <AccountError onRetry={reset} />;
}
