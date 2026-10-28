'use client';
// The close dialog (#68): closing an obligation always asks for a reason, from the row menu, the
// swipe and the `d` key alike. "Not applicable" also needs a note in words. There is no silent close.
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Textarea } from '@causedeck/ui/textarea';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';

export const OBLIGATION_CLOSE_REASONS = [
  'task_completed',
  'lawyer_action',
  'not_applicable',
] as const;
export type CloseReason = (typeof OBLIGATION_CLOSE_REASONS)[number];

export interface CloseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  pending?: boolean;
  onSubmit: (input: { reason: CloseReason; note?: string }) => void;
}

export function CloseDialog({
  open,
  onOpenChange,
  title,
  pending = false,
  onSubmit,
}: CloseDialogProps) {
  const t = useTranslations('obligations.close');
  const [reason, setReason] = useState<CloseReason | null>(null);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const needsNote = reason === 'not_applicable' && note.trim() === '';
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setTouched(true);
    if (reason === null || needsNote) return;
    onSubmit(note.trim() === '' ? { reason } : { reason, note: note.trim() });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason(null);
          setNote('');
          setTouched(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent data-slot="obligation-close-dialog">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>
              {title}. {t('description')}
            </DialogDescription>
          </DialogHeader>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-ink mb-1 text-sm font-medium">{t('reason')}</legend>
            {OBLIGATION_CLOSE_REASONS.map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="reason"
                  value={value}
                  checked={reason === value}
                  onChange={() => {
                    setReason(value);
                  }}
                />
                {t(`reasons.${value}`)}
              </label>
            ))}
            {touched && reason === null ? (
              <span role="alert" className="text-danger text-xs">
                {t('reason')}
              </span>
            ) : null}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm">
            {t('note')}
            <Textarea
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              aria-invalid={touched && needsNote ? true : undefined}
            />
            {touched && needsNote ? (
              <span role="alert" className="text-danger text-xs">
                {t('noteRequired')}
              </span>
            ) : null}
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
