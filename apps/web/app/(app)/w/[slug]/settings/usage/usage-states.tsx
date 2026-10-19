'use client';

// Usage error, empty and permission-denied states (#223). `UsageError` is `Could not load usage.`
// with `Try again` (a fresh server render, or the route boundary's `reset`), shared by the page and
// `error.tsx`. `UsagePermissionDenied` is shown to roles without `billing.read` (owners only), with
// the usage copy rather than the shell's generic one. `UsageEmpty` is `No usage yet this month.`
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { PermissionDenied } from '@causedeck/ui/patterns';
import { Gauge } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function UsageError({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations('usage.error');
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

/** The shell's `No access` heading with the usage copy. */
export function UsagePermissionDenied() {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-serif text-2xl font-medium">{t('shell.permissionDenied.title')}</h1>
      <PermissionDenied message={t('usage.permissionDenied')} />
    </div>
  );
}

export function UsageEmpty() {
  const t = useTranslations('usage.empty');
  return (
    <EmptyState
      data-pattern-state="empty"
      data-slot="usage-empty"
      icon={<Gauge aria-hidden="true" />}
      title={t('title')}
      description={t('description')}
    />
  );
}
