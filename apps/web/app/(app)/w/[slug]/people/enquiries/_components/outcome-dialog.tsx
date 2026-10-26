'use client';
// Close an enquiry (#874, #87): an optional reason, kept on the enquiry. Nothing is sent to the
// enquirer. `Esc` closes the dialog and focus returns to the invoker.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Field } from '@causedeck/ui/field';
import { Textarea } from '@causedeck/ui/textarea';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';

import { enquiryErrorKey, type EnquiryActions } from './enquiry-actions.ts';

export interface OutcomeDialogProps {
  workspaceId: string;
  enquiryId: string | null;
  onOpenChange: (open: boolean) => void;
  offline: boolean;
  close: EnquiryActions['close'];
}

export function OutcomeDialog({
  workspaceId,
  enquiryId,
  onOpenChange,
  offline,
  close,
}: OutcomeDialogProps) {
  const t = useTranslations('enquiry');
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || offline || enquiryId === null) return;
    setSaving(true);
    setError(null);
    try {
      const result = await close({
        workspaceId,
        enquiryId,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
      if (result.ok) {
        setReason('');
        onOpenChange(false);
        router.refresh();
        return;
      }
      setError(t(`form.error.${enquiryErrorKey(result.error.code)}`));
    } catch {
      setError(t('form.error.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={enquiryId !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('outcome.title')}</DialogTitle>
        </DialogHeader>
        {error === null ? null : (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        <form
          noValidate
          id="enquiry-outcome-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => void onSubmit(event)}
        >
          <Field label={t('outcome.reason')} hint={t('outcome.hint')}>
            <Textarea
              data-enquiry-field="reason"
              value={reason}
              maxLength={500}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </Field>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('form.cancel')}
          </Button>
          <Button type="submit" form="enquiry-outcome-form" disabled={saving || offline}>
            {saving ? t('form.saving') : t('outcome.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
