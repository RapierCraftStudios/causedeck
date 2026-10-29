'use client';

// The acknowledgement dialog (#828): a lawyer who exports a draft with citations the checker could
// not find ticks "I have verified these authorities myself", then confirms. `onConfirm` sends the
// acknowledgement (`acknowledgeUnverified`, audited in core). Confirm stays off until the box is
// ticked, and the dialog closes only on success.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Checkbox } from '@causedeck/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

export interface AckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Not-found citations this acknowledgement covers. */
  count: number;
  /** Resolves true when the acknowledgement was recorded. `statement` is what the lawyer ticked. */
  onConfirm: (statement: string) => Promise<boolean>;
}

export function AckDialog({ open, onOpenChange, count, onConfirm }: AckDialogProps) {
  const t = useTranslations('drafting.checks.ack');
  const checkId = useId();
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  function close(next: boolean) {
    if (!next) {
      setTicked(false);
      setFailed(false);
    }
    onOpenChange(next);
  }

  async function confirm() {
    setBusy(true);
    setFailed(false);
    const ok = await onConfirm(t('checkbox'));
    setBusy(false);
    if (ok) close(false);
    else setFailed(true);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-slot="ack-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { count })}</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2">
          <Checkbox
            id={checkId}
            checked={ticked}
            onCheckedChange={(value) => {
              setTicked(value === true);
            }}
          />
          <label htmlFor={checkId} className="text-sm">
            {t('checkbox')}
          </label>
        </div>
        {failed ? (
          <Alert tone="danger" role="alert">
            {t('failed')}
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              close(false);
            }}
          >
            {t('cancel')}
          </Button>
          <Button type="button" disabled={!ticked || busy} onClick={() => void confirm()}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
