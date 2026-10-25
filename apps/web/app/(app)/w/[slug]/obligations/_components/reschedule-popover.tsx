'use client';
// Reschedule (#68): a date picker and a mandatory reason; the service refuses a date change
// without one. Opens from the row menu, the left swipe and the `r` key.
import { Button } from '@causedeck/ui/button';
import { DatePicker } from '@causedeck/ui/date-picker';
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
import { useState, type FormEvent } from 'react';

export interface RescheduleProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** `YYYY-MM-DD`, or null for an undated task. */
  current: string | null;
  pending?: boolean;
  onSubmit: (input: { dueDate: string; reason: string }) => void;
}

const toDay = (date: Date) =>
  `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function ReschedulePopover({
  open,
  onOpenChange,
  title,
  current,
  pending = false,
  onSubmit,
}: RescheduleProps) {
  const t = useTranslations('obligations.rescheduleDialog');
  const [date, setDate] = useState<Date | null>(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (date === null || reason.trim() === '') return;
    onSubmit({ dueDate: toDay(date), reason: reason.trim() });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDate(null);
          setReason('');
          setTouched(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent data-slot="obligation-reschedule">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>
              {title}. {t('description')}
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-sm">
            {t('date')}
            <DatePicker
              value={date}
              defaultValue={current === null ? null : new Date(`${current}T00:00:00`)}
              onChange={setDate}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('reason')}
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={touched && reason.trim() === '' ? true : undefined}
            />
            {touched && reason.trim() === '' ? (
              <span role="alert" className="text-danger text-xs">
                {t('reasonRequired')}
              </span>
            ) : null}
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
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
