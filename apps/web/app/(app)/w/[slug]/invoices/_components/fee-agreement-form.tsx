'use client';
// New fee agreement (#871, #83): the matter, the client, the basis, the amount and the GST
// treatment. The amount is typed in rupees and sent as paise; the server checks everything again.
// A saved agreement is a proposal until it is activated. `Esc` closes the dialog and focus returns
// to the invoker; `Cmd/Ctrl+Enter` saves. Offline, saving is off.
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
import { useHotkey } from '@causedeck/ui/hooks';
import { Input } from '@causedeck/ui/input';
import { FEE_BASES, GST_TREATMENTS } from '@causedeck/validators/fees';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import type { PickerOption } from '../../../../../../lib/fees/fees-deps.ts';
import { rupeesToPaise } from '../../../../../../lib/fees/money.ts';

import { FeePicker } from './fee-picker.tsx';
import { feesErrorKey, type FeesActions } from './fees-actions.ts';

export interface FeeAgreementFormProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offline?: boolean;
  create: FeesActions['createAgreement'];
  /** The matters and clients to choose from (#963). */
  matters?: readonly PickerOption[];
  clients?: readonly PickerOption[];
}

const SELECT_CLASS = 'border-line-control bg-surface h-9 w-full rounded-md border px-2 text-sm';

export function FeeAgreementForm({
  workspaceId,
  open,
  onOpenChange,
  offline = false,
  create,
  matters = [],
  clients = [],
}: FeeAgreementFormProps) {
  const t = useTranslations('fees');
  const router = useRouter();
  const basisId = useId();
  const gstId = useId();
  const [matterId, setMatterId] = useState('');
  const [personId, setPersonId] = useState('');
  const [basis, setBasis] = useState<(typeof FEE_BASES)[number]>('fixed');
  const [amount, setAmount] = useState('');
  const [gstTreatment, setGstTreatment] =
    useState<(typeof GST_TREATMENTS)[number]>('forward_charge');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (offline || saving) return;
    const amountPaise = rupeesToPaise(amount);
    if (amountPaise === null || matterId === '' || personId === '') {
      setError(t('error.invalid'));
      return;
    }
    setSaving(true);
    setError(null);
    const result = await create({
      workspaceId,
      agreement: {
        matterId,
        personId,
        basis,
        amountPaise,
        gstTreatment,
        startsOn,
        ...(endsOn === '' ? {} : { endsOn }),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      },
    });
    setSaving(false);
    if (!result.ok) {
      setError(t(`error.${feesErrorKey(result.error.code)}`));
      return;
    }
    onOpenChange(false);
    router.refresh();
  };

  useHotkey(
    'mod+enter',
    () => {
      void submit();
    },
    { enabled: open },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('agreementForm.title')}</DialogTitle>
        </DialogHeader>
        {error === null ? null : (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        <form
          noValidate
          id="fee-agreement-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FeePicker
            label={t('agreementForm.matter')}
            field="matter"
            options={matters}
            value={matterId}
            onChange={setMatterId}
            required
          />
          <FeePicker
            label={t('agreementForm.person')}
            field="person"
            options={clients}
            value={personId}
            onChange={setPersonId}
            required
          />
          <Field label={t('agreementForm.basis')} controlId={basisId}>
            <select
              id={basisId}
              data-fees-field="basis"
              className={SELECT_CLASS}
              value={basis}
              onChange={(event) => {
                setBasis(event.target.value as (typeof FEE_BASES)[number]);
              }}
            >
              {FEE_BASES.map((value) => (
                <option key={value} value={value}>
                  {t(`basis.${value}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('agreementForm.amount')} required>
            <Input
              inputMode="decimal"
              data-fees-field="amount"
              className="tabular-nums"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
              }}
            />
          </Field>
          <Field label={t('agreementForm.gst')} controlId={gstId}>
            <select
              id={gstId}
              data-fees-field="gst"
              className={SELECT_CLASS}
              value={gstTreatment}
              onChange={(event) => {
                setGstTreatment(event.target.value as (typeof GST_TREATMENTS)[number]);
              }}
            >
              {GST_TREATMENTS.map((value) => (
                <option key={value} value={value}>
                  {t(`gst.${value}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('agreementForm.starts')} required>
            <Input
              type="date"
              data-fees-field="starts"
              value={startsOn}
              onChange={(event) => {
                setStartsOn(event.target.value);
              }}
            />
          </Field>
          <Field label={t('agreementForm.ends')}>
            <Input
              type="date"
              data-fees-field="ends"
              value={endsOn}
              onChange={(event) => {
                setEndsOn(event.target.value);
              }}
            />
          </Field>
          <Field label={t('agreementForm.notes')}>
            <Input
              data-fees-field="notes"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
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
            {t('agreementForm.cancel')}
          </Button>
          <Button type="submit" form="fee-agreement-form" disabled={saving || offline}>
            {t('agreementForm.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
