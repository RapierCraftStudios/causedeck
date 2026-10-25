'use client';

// Export error state (#288): `Could not load the export page.` with `Try again`
// (the route boundary's `reset`). The boundary reports the error and never shows its message.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../../lib/report-error.ts';

interface ExportErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ExportErrorBoundary({ error, reset }: ExportErrorBoundaryProps) {
  const t = useTranslations('settings.export.error');
  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);
  return (
    <Alert
      tone="danger"
      data-pattern-state="error"
      action={
        <Button variant="secondary" size="sm" onClick={reset}>
          {t('retry')}
        </Button>
      }
    >
      {t('title')}
    </Alert>
  );
}
