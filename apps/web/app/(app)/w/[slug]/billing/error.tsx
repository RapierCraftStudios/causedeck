'use client';

// Billing error and permission-denied states (#256). `BillingError` is `Could not load billing.`
// with `Try again` (a fresh server render, or the boundary's `reset`); the route boundary below
// catches anything the page throws. `BillingPermissionDenied` is shown to roles without
// `billing.read` (owners only), with the billing copy rather than the shell's generic one.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { PermissionDenied } from '@causedeck/ui/patterns';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../lib/report-error.ts';

export function BillingError({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations('billing.error');
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

/** The shell's `No access` heading with the billing copy. */
export function BillingPermissionDenied() {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-serif text-2xl font-medium">{t('shell.permissionDenied.title')}</h1>
      <PermissionDenied message={t('billing.permissionDenied')} />
    </div>
  );
}

interface BillingErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Route error boundary: reports the error (never shows its message) and offers `Try again`. */
export default function BillingErrorBoundary({ error, reset }: BillingErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);
  return <BillingError onRetry={reset} />;
}
