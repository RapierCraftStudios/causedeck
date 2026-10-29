'use client';
// The buttons that open the record forms (#963): payment and credit note on a final invoice,
// expense and receipt in the client's ledger. Owners and advocates write; offline the buttons are
// off and say why. A paid invoice takes a credit note but no further payment.
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useOnline } from '../../../../../../components/matters/matters-offline-banner.tsx';
import type { PickerOption } from '../../../../../../lib/fees/fees-deps.ts';

import { CreditNoteForm, LedgerEntryForm, PaymentForm } from './fee-record-forms.tsx';
import type { FeesActions } from './fees-actions.ts';

export interface InvoiceRecordActionsProps {
  workspaceId: string;
  invoiceId: string;
  /** `issued` takes a payment and a credit note; `paid` only a credit note. */
  status: 'issued' | 'paid';
  canWrite: boolean;
  actions: Pick<FeesActions, 'recordPayment' | 'issueCreditNote'>;
  /** Dev preview of the offline state. */
  forceOffline?: boolean;
}

export function InvoiceRecordActions({
  workspaceId,
  invoiceId,
  status,
  canWrite,
  actions,
  forceOffline = false,
}: InvoiceRecordActionsProps) {
  const t = useTranslations('fees');
  const online = useOnline() && !forceOffline;
  const [open, setOpen] = useState<'payment' | 'credit' | null>(null);
  if (!canWrite) return null;
  const title = online ? undefined : t('offline');
  return (
    <div className="flex flex-wrap gap-2" data-slot="invoice-record-actions">
      {status === 'issued' ? (
        <Button
          type="button"
          data-slot="record-payment"
          disabled={!online}
          title={title}
          onClick={() => {
            setOpen('payment');
          }}
        >
          {t('paymentForm.trigger')}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        data-slot="issue-credit-note"
        disabled={!online}
        title={title}
        onClick={() => {
          setOpen('credit');
        }}
      >
        {t('creditNoteForm.trigger')}
      </Button>
      <PaymentForm
        workspaceId={workspaceId}
        invoiceId={invoiceId}
        open={open === 'payment'}
        onOpenChange={(next) => {
          setOpen(next ? 'payment' : null);
        }}
        offline={!online}
        record={actions.recordPayment}
      />
      <CreditNoteForm
        workspaceId={workspaceId}
        invoiceId={invoiceId}
        open={open === 'credit'}
        onOpenChange={(next) => {
          setOpen(next ? 'credit' : null);
        }}
        offline={!online}
        issue={actions.issueCreditNote}
      />
    </div>
  );
}

export interface LedgerRecordActionsProps {
  workspaceId: string;
  personId: string;
  /** The matter the forms start with. */
  matterId?: string | undefined;
  matters: readonly PickerOption[];
  canWrite: boolean;
  actions: Pick<FeesActions, 'recordExpense' | 'recordReceipt'>;
  /** Dev preview of the offline state. */
  forceOffline?: boolean;
}

export function LedgerRecordActions({
  workspaceId,
  personId,
  matterId,
  matters,
  canWrite,
  actions,
  forceOffline = false,
}: LedgerRecordActionsProps) {
  const t = useTranslations('fees');
  const online = useOnline() && !forceOffline;
  const [open, setOpen] = useState<'expense' | 'receipt' | null>(null);
  if (!canWrite) return null;
  const title = online ? undefined : t('offline');
  return (
    <div className="flex flex-wrap gap-2" data-slot="ledger-record-actions">
      <Button
        type="button"
        variant="outline"
        data-slot="record-expense"
        disabled={!online}
        title={title}
        onClick={() => {
          setOpen('expense');
        }}
      >
        {t('expenseForm.trigger')}
      </Button>
      <Button
        type="button"
        variant="outline"
        data-slot="record-receipt"
        disabled={!online}
        title={title}
        onClick={() => {
          setOpen('receipt');
        }}
      >
        {t('receiptForm.trigger')}
      </Button>
      <LedgerEntryForm
        kind="expense"
        workspaceId={workspaceId}
        personId={personId}
        matterId={matterId}
        matters={matters}
        open={open === 'expense'}
        onOpenChange={(next) => {
          setOpen(next ? 'expense' : null);
        }}
        offline={!online}
        record={actions.recordExpense}
      />
      <LedgerEntryForm
        kind="receipt"
        workspaceId={workspaceId}
        personId={personId}
        matterId={matterId}
        matters={matters}
        open={open === 'receipt'}
        onOpenChange={(next) => {
          setOpen(next ? 'receipt' : null);
        }}
        offline={!online}
        record={actions.recordReceipt}
      />
    </div>
  );
}
