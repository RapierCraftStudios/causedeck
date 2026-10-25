'use client';

// Profile error state (#284): `Could not load the workspace profile.` with `Try again` (a fresh
// server render, or the route boundary's `reset`). The route boundary reports the error and never
// shows its message.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../../lib/report-error.ts';

export function ProfileError({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations('settings.profile.error');
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

interface ProfileErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ProfileErrorBoundary({ error, reset }: ProfileErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);
  return <ProfileError onRetry={reset} />;
}
