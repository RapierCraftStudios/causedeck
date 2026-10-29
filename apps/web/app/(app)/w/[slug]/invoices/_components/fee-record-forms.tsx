'use client';
// The record forms (#963): a payment received against a final invoice, a credit note on it, and an
// expense or a receipt in the client's ledger. Each is a dialog: amounts are typed in rupees and
// sent as paise, the server checks everything again, and a saved record refreshes the page. Esc
// closes and focus returns to the invoker; Cmd/Ctrl+Enter saves. Offline, saving is off. These only
// record money the advocate already handled: nothing is sent, charged or transferred.
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
import { PAYMENT_METHODS, type PaymentMethod } from '@causedeck/validators/fees';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';

import type { PickerOption } from '../../../../../../lib/fees/fees-deps.ts';
import { rupeesToPaise } from '../../../../../../lib/fees/money.ts';

import { FeePicker } from './fee-picker.tsx';
import { feesErrorKey, type FeesActions } from './fees-actions.ts';

interface DialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offline?: boolean;
}

const SELECT_CLASS = 'border-line-control bg-surface h-9 w-full rounded-md border px-2 text-sm';

type Run = () => Promise<{ ok: true } | { ok: false; code: string }>;

/** The shared submit: busy flag, the translated error, and a refresh when the record is saved. */
function useRecordSubmit(offline: boolean, onOpenChange: (open: boolean) => void) {
  const t = useTranslations('fees');
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (run: Run) => {
    if (offline || saving) return;
    setSaving(true);
    setError(null);
    const result = await run();
    setSaving(false);
    if (!result.ok) {
      setError(t(`error.${feesErrorKey(result.code)}`));
      return;
    }
    onOpenChange(false);
    router.refresh();
  };
  const invalid = () => {
    setError(t('error.invalid'));
  };
  return { saving, error, submit, invalid };
}

function RecordDialog({
  open,
  onOpenChange,
  title,
  formId,
  error,
  saving,
  offline,
  submitLabel,
  cancelLabel,
  children,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  formId: string;
  error: string | null;
  saving: boolean;
  offline: boolean;
  submitLabel: string;
  cancelLabel: string;
  children: ReactNode;
  onSubmit: () => void;
}) {
  const t = useTranslations('fees');
  useHotkey('mod+enter', onSubmit, { enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {offline ? (
          <Alert tone="warning" role="status">
            {t('offline')}
          </Alert>
        ) : null}
        {error === null ? null : (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        <form
          noValidate
          id={formId}
          className="flex flex-col gap-4"
          aria-busy={saving}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {children}
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {cancelLabel}
          </Button>
          <Button type="submit" form={formId} disabled={saving || offline}>
            {saving ? t('record.saving') : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface PaymentFormProps extends DialogProps {
  invoiceId: string;
  record: FeesActions['recordPayment'];
}

export function PaymentForm({
  workspaceId,
  invoiceId,
  open,
  onOpenChange,
  offline = false,
  record,
}: PaymentFormProps) {
  const t = useTranslations('fees');
  const methodId = useId();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const { saving, error, submit, invalid } = useRecordSubmit(offline, onOpenChange);

  const save = () => {
    const amountPaise = rupeesToPaise(amount);
    if (amountPaise === null || amountPaise < 1 || receivedOn === '') {
      invalid();
      return;
    }
    void submit(async () => {
      const result = await record({
        workspaceId,
        payment: {
          invoiceId,
          amountPaise,
          method,
          receivedOn,
          ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        },
      });
      return result.ok ? { ok: true } : { ok: false, code: result.error.code };
    });
  };

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('paymentForm.title')}
      formId="fee-payment-form"
      error={error}
      saving={saving}
      offline={offline}
      submitLabel={t('paymentForm.submit')}
      cancelLabel={t('record.cancel')}
      onSubmit={save}
    >
      <Field label={t('record.amount')} required>
        <Input
          inputMode="decimal"
          className="tabular-nums"
          data-fees-field="payment-amount"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </Field>
      <Field label={t('paymentForm.method')} controlId={methodId}>
        <select
          id={methodId}
          data-fees-field="payment-method"
          className={SELECT_CLASS}
          value={method}
          onChange={(event) => {
            setMethod(event.target.value as PaymentMethod);
          }}
        >
          {PAYMENT_METHODS.map((value) => (
            <option key={value} value={value}>
              {t(`paymentForm.methods.${value}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('record.reference')}>
        <Input
          data-fees-field="payment-reference"
          value={reference}
          onChange={(event) => {
            setReference(event.target.value);
          }}
        />
      </Field>
      <Field label={t('paymentForm.receivedOn')} required>
        <Input
          type="date"
          data-fees-field="payment-date"
          value={receivedOn}
          onChange={(event) => {
            setReceivedOn(event.target.value);
          }}
        />
      </Field>
    </RecordDialog>
  );
}

export interface CreditNoteFormProps extends DialogProps {
  invoiceId: string;
  issue: FeesActions['issueCreditNote'];
}

export function CreditNoteForm({
  workspaceId,
  invoiceId,
  open,
  onOpenChange,
  offline = false,
  issue,
}: CreditNoteFormProps) {
  const t = useTranslations('fees');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [occurredOn, setOccurredOn] = useState('');
  const { saving, error, submit, invalid } = useRecordSubmit(offline, onOpenChange);

  const save = () => {
    const amountPaise = rupeesToPaise(amount);
    if (amountPaise === null || amountPaise < 1 || reason.trim() === '' || occurredOn === '') {
      invalid();
      return;
    }
    void submit(async () => {
      const result = await issue({
        workspaceId,
        creditNote: { invoiceId, amountPaise, reason: reason.trim(), occurredOn },
      });
      return result.ok ? { ok: true } : { ok: false, code: result.error.code };
    });
  };

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('creditNoteForm.title')}
      formId="fee-credit-note-form"
      error={error}
      saving={saving}
      offline={offline}
      submitLabel={t('creditNoteForm.submit')}
      cancelLabel={t('record.cancel')}
      onSubmit={save}
    >
      <p className="text-ink-muted text-sm">{t('creditNoteForm.hint')}</p>
      <Field label={t('record.amount')} required>
        <Input
          inputMode="decimal"
          className="tabular-nums"
          data-fees-field="credit-amount"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </Field>
      <Field label={t('creditNoteForm.reason')} required>
        <Input
          data-fees-field="credit-reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </Field>
      <Field label={t('record.date')} required>
        <Input
          type="date"
          data-fees-field="credit-date"
          value={occurredOn}
          onChange={(event) => {
            setOccurredOn(event.target.value);
          }}
        />
      </Field>
    </RecordDialog>
  );
}

export interface LedgerEntryFormProps extends DialogProps {
  /** An expense is a debit; a receipt is a credit. */
  kind: 'expense' | 'receipt';
  personId: string;
  /** The matter chosen to start with (the invoice's), or none. */
  matterId?: string | undefined;
  matters: readonly PickerOption[];
  record: FeesActions['recordExpense'] | FeesActions['recordReceipt'];
}

export function LedgerEntryForm({
  workspaceId,
  kind,
  personId,
  matterId: initialMatter = '',
  matters,
  open,
  onOpenChange,
  offline = false,
  record,
}: LedgerEntryFormProps) {
  const t = useTranslations('fees');
  const [matterId, setMatterId] = useState(initialMatter);
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const { saving, error, submit, invalid } = useRecordSubmit(offline, onOpenChange);
  const isExpense = kind === 'expense';

  const save = () => {
    const amountPaise = rupeesToPaise(amount);
    if (
      amountPaise === null ||
      amountPaise < 1 ||
      date === '' ||
      (isExpense && text.trim() === '')
    ) {
      invalid();
      return;
    }
    const matter = matterId === '' ? {} : { matterId };
    void submit(async () => {
      const result = await record(
        isExpense
          ? {
              workspaceId,
              expense: {
                personId,
                ...matter,
                amountPaise,
                description: text.trim(),
                occurredOn: date,
              },
            }
          : {
              workspaceId,
              receipt: {
                personId,
                ...matter,
                amountPaise,
                receivedOn: date,
                ...(text.trim() === '' ? {} : { reference: text.trim() }),
              },
            },
      );
      return result.ok ? { ok: true } : { ok: false, code: result.error.code };
    });
  };

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isExpense ? t('expenseForm.title') : t('receiptForm.title')}
      formId={`fee-${kind}-form`}
      error={error}
      saving={saving}
      offline={offline}
      submitLabel={isExpense ? t('expenseForm.submit') : t('receiptForm.submit')}
      cancelLabel={t('record.cancel')}
      onSubmit={save}
    >
      <FeePicker
        label={t('record.matter')}
        field="ledger-matter"
        options={matters}
        value={matterId}
        onChange={setMatterId}
        noneLabel={t('record.noMatter')}
      />
      <Field label={t('record.amount')} required>
        <Input
          inputMode="decimal"
          className="tabular-nums"
          data-fees-field="ledger-amount"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </Field>
      <Field
        label={isExpense ? t('expenseForm.description') : t('record.reference')}
        required={isExpense}
      >
        <Input
          data-fees-field="ledger-text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </Field>
      <Field label={t('record.date')} required>
        <Input
          type="date"
          data-fees-field="ledger-date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
        />
      </Field>
    </RecordDialog>
  );
}
