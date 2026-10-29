'use client';
// One fee agreement (#871, #83). A draft agreement is a proposal (including one staged by
// automation): nothing is agreed until an owner or advocate activates it. Active ones can be ended.
import type { FeeAgreementView } from '@causedeck/core/fees';
import { Badge, type BadgeTone } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { useLocale, useTranslations } from 'next-intl';

import { formatPaise } from '../../../../../../lib/fees/money.ts';

export interface FeeProposalCardProps {
  agreement: FeeAgreementView;
  canWrite: boolean;
  busy: boolean;
  onStatus: (agreementId: string, status: 'active' | 'ended') => void;
}

type AgreementStatus = 'draft' | 'active' | 'ended';
const TONE: Record<AgreementStatus, BadgeTone> = {
  draft: 'warning',
  active: 'success',
  ended: 'neutral',
};

export function FeeProposalCard({ agreement, canWrite, busy, onStatus }: FeeProposalCardProps) {
  const t = useTranslations('fees');
  const locale = useLocale();
  const status = agreement.status as AgreementStatus;
  return (
    <li
      data-slot="fee-agreement-card"
      data-agreement-id={agreement.id}
      className="border-line rounded-md border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-ink-muted text-xs">
            {t(`basis.${agreement.basis as 'fixed' | 'hourly' | 'retainer' | 'per_appearance'}`)}
          </span>
          <span className="font-serif text-xl font-medium tabular-nums">
            {formatPaise(agreement.amountPaise, locale)}
          </span>
          <span className="text-ink-muted text-xs">
            {t('agreement.matter', { id: agreement.matterId })}
          </span>
          <span className="text-ink-muted text-xs tabular-nums">
            {t('agreement.starts')}: {agreement.startsOn}
            {agreement.endsOn ? ` · ${t('agreement.ends')}: ${agreement.endsOn}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={TONE[status]} data-status={status}>
            {t(`agreementStatus.${status}`)}
          </Badge>
          {canWrite && status === 'draft' ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                onStatus(agreement.id, 'active');
              }}
            >
              {t('agreement.activate')}
            </Button>
          ) : null}
          {canWrite && status === 'active' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                onStatus(agreement.id, 'ended');
              }}
            >
              {t('agreement.end')}
            </Button>
          ) : null}
        </div>
      </div>
      {status === 'draft' ? (
        <p className="text-ink-muted mt-2 text-xs">{t('agreement.proposedNote')}</p>
      ) : null}
    </li>
  );
}
