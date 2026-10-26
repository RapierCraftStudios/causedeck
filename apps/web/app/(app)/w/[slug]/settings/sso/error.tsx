'use client';

// SSO settings error state (#683): `Could not load the SSO settings.` with `Try again`. The route
// boundary reports the error and never shows its message.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../../lib/report-error.ts';

export function SsoError({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations('settings.sso.error');
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

interface SsoErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function SsoErrorBoundary({ error, reset }: SsoErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);
  return <SsoError onRetry={reset} />;
}
