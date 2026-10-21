'use client';

// Cancel and resume (#257). `Cancel plan` confirms a cancellation at the end of the current period
// and says what happens next: the workspace stays on the plan until then, and afterwards its data
// remains accessible read-only and can be exported (#31). A subscription set to cancel, or paused,
// shows `Resume plan` instead. Disabled offline.
import { Alert } from '@causedeck/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@causedeck/ui/alert-dialog';
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { cancelAtPeriodEnd, resumeSubscription } from './actions.ts';
import type { ManageView } from './billing-view.ts';
import { billingErrorKey, useOnline, type BillingErrorKey } from './seat-manager.tsx';

export interface CancelDialogProps {
  workspaceId: string;
  slug: string;
  manage: Pick<ManageView, 'cancelAtPeriodEnd' | 'paused' | 'periodEnd'>;
}

export function CancelDialog({ workspaceId, slug, manage }: CancelDialogProps) {
  const t = useTranslations('billing.cancel');
  const tErrors = useTranslations('billing.errors');
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BillingErrorKey | null>(null);

  async function run(action: typeof cancelAtPeriodEnd): Promise<boolean> {
    setError(null);
    setPending(true);
    try {
      const key = billingErrorKey(await action({ workspaceId, slug }));
      if (key !== null) setError(key);
      return key === null;
    } catch {
      setError('generic');
      return false;
    } finally {
      setPending(false);
    }
  }

  if (manage.cancelAtPeriodEnd || manage.paused) {
    return (
      <div data-slot="billing-resume" className="flex flex-col gap-2">
        <p className="text-ink-muted text-sm">{t('readOnlyNote')}</p>
        <div>
          <Button
            variant="primary"
            disabled={pending || !online}
            aria-busy={pending || undefined}
            onClick={() => void run(resumeSubscription)}
          >
            {t('resume')}
          </Button>
        </div>
        {error ? <Alert tone="danger">{tErrors(error)}</Alert> : null}
      </div>
    );
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="ghost" disabled={!online}>
          {t('open')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent data-dialog="cancel-plan">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {manage.periodEnd ? t('body', { date: manage.periodEnd }) : t('bodyNoDate')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm">{t('readOnlyNote')}</p>
        {error ? <Alert tone="danger">{tErrors(error)}</Alert> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending || !online}
            aria-busy={pending || undefined}
            onClick={(event) => {
              // Keep the dialog open until the action resolves; errors render inline.
              event.preventDefault();
              void run(cancelAtPeriodEnd).then((ok) => {
                if (ok) setOpen(false);
              });
            }}
          >
            {t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
