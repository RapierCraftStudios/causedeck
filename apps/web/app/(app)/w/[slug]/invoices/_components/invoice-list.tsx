'use client';
// The fees list (#871, #83): fee agreements (proposals until activated) and invoices, with the
// empty and offline states. Shortcuts: `n` starts a new invoice, `Cmd/Ctrl+Enter` saves the
// agreement dialog; plain keys are ignored while typing (useHotkey) and while a dialog is open.
// Offline, the screen is read-only. Amounts are tabular and Indian-grouped. Nothing here sends,
// charges or transfers anything.
import type { FeeAgreementView, FeeInvoiceRow } from '@causedeck/core/fees';
import { Alert } from '@causedeck/ui/alert';
import { Badge, type BadgeTone } from '@causedeck/ui/badge';
import { buttonVariants, Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { useHotkey } from '@causedeck/ui/hooks';
import { OfflineBanner } from '@causedeck/ui/patterns';
import { ReceiptIndianRupee } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  useOfflineSince,
  useOnline,
} from '../../../../../../components/matters/matters-offline-banner.tsx';
import { formatPaise } from '../../../../../../lib/fees/money.ts';

import { FeeAgreementForm } from './fee-agreement-form.tsx';
import { FeeProposalCard } from './fee-proposal-card.tsx';
import { feesErrorKey, type FeesActions } from './fees-actions.ts';

export interface InvoiceListProps {
  workspaceId: string;
  /** `/w/<slug>/invoices`, the base of every link. */
  basePath: string;
  agreements: readonly FeeAgreementView[];
  invoices: readonly FeeInvoiceRow[];
  /** Owners and advocates write. */
  canWrite: boolean;
  actions: Pick<FeesActions, 'createAgreement' | 'setAgreementStatus'>;
  /** Dev preview of the offline banner. */
  forceOffline?: boolean;
}

type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void';
const TONE: Record<InvoiceStatus, BadgeTone> = {
  draft: 'neutral',
  issued: 'accent',
  paid: 'success',
  void: 'warning',
};

const dialogOpen = () => document.querySelector('[role="dialog"]') !== null;

export function InvoiceList({
  workspaceId,
  basePath,
  agreements,
  invoices,
  canWrite,
  actions,
  forceOffline = false,
}: InvoiceListProps) {
  const t = useTranslations('fees');
  const locale = useLocale();
  const router = useRouter();
  const online = useOnline() && !forceOffline;
  const canEdit = canWrite && online;
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStatus = async (agreementId: string, status: 'active' | 'ended') => {
    setBusy(true);
    setError(null);
    const result = await actions.setAgreementStatus({ workspaceId, agreementId, status });
    setBusy(false);
    if (!result.ok) {
      setError(t(`error.${feesErrorKey(result.error.code)}`));
      return;
    }
    router.refresh();
  };

  useHotkey(
    'n',
    (event) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey || !canEdit || dialogOpen()) return;
      event.preventDefault();
      router.push(`${basePath}/new`);
    },
    { preventDefault: false },
  );

  const newInvoice = canWrite ? (
    <Link
      href={`${basePath}/new`}
      data-slot="new-invoice"
      aria-disabled={!canEdit}
      tabIndex={canEdit ? undefined : -1}
      className={buttonVariants()}
      onClick={(event) => {
        if (!canEdit) event.preventDefault();
      }}
    >
      {t('invoices.new')}
    </Link>
  ) : null;
  const newAgreement = canWrite ? (
    <Button
      type="button"
      variant="outline"
      data-slot="new-agreement"
      disabled={!canEdit}
      title={online ? undefined : t('offline')}
      onClick={() => {
        setFormOpen(true);
      }}
    >
      {t('agreementForm.trigger')}
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-8">
      <OfflineNotice forced={forceOffline} />
      {error === null ? null : (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <section aria-labelledby="fees-agreements" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="fees-agreements" className="font-serif text-lg font-medium">
            {t('agreements.title')}
          </h2>
          {newAgreement}
        </div>
        {agreements.length === 0 ? (
          <EmptyState
            data-pattern-state="empty"
            icon={<ReceiptIndianRupee />}
            title={t('agreements.empty.title')}
            description={t('agreements.empty.body')}
          />
        ) : (
          <ul aria-label={t('agreements.label')} className="flex flex-col gap-2">
            {agreements.map((agreement) => (
              <FeeProposalCard
                key={agreement.id}
                agreement={agreement}
                canWrite={canWrite}
                busy={busy || !online}
                onStatus={(id, status) => {
                  void setStatus(id, status);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="fees-invoices" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="fees-invoices" className="font-serif text-lg font-medium">
            {t('invoices.title')}
          </h2>
          {newInvoice}
        </div>
        {invoices.length === 0 ? (
          <EmptyState
            data-pattern-state="empty"
            icon={<ReceiptIndianRupee />}
            title={t('invoices.empty.title')}
            description={t('invoices.empty.body')}
          />
        ) : (
          <ul aria-label={t('invoices.label')} className="flex flex-col gap-2">
            {invoices.map((invoice) => {
              const status = invoice.status as InvoiceStatus;
              return (
                <li
                  key={invoice.id}
                  data-slot="invoice-row"
                  className="border-line flex flex-wrap items-center justify-between gap-3 rounded-md border p-4"
                >
                  <div className="flex flex-col gap-1">
                    <Link
                      href={`${basePath}/${invoice.id}`}
                      className="focus-visible:ring-focus font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2"
                    >
                      {invoice.number ?? t('invoices.draftNumber')}
                    </Link>
                    <span className="text-ink-muted text-xs">
                      {t('invoices.matter', { id: invoice.matterId })}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-right tabular-nums">
                      {formatPaise(invoice.totalPaise, locale)}
                    </span>
                    <Badge tone={TONE[status]} data-status={status}>
                      {t(`status.${status}`)}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <FeeAgreementForm
        workspaceId={workspaceId}
        open={formOpen}
        onOpenChange={setFormOpen}
        offline={!online}
        create={actions.createAgreement}
      />
      <p className="text-ink-muted text-xs" data-slot="fees-shortcuts">
        {t('shortcuts.new')}
      </p>
    </div>
  );
}

function OfflineNotice({ forced }: { forced: boolean }) {
  const t = useTranslations('fees');
  const locale = useLocale();
  const offlineSince = useOfflineSince();
  const since = offlineSince ?? (forced ? new Date(0) : null);
  if (since === null) return null;
  return (
    <OfflineBanner
      data-fees-offline=""
      savedAt={since}
      locale={`${locale}-IN`}
      labels={{ message: () => t('offline') }}
    />
  );
}
