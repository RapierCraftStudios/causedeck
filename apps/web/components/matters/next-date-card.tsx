'use client';
// The Next-date card (#390, #40 design spec), the Overview's hero: the canonical next date as a
// large tabular date with its weekday, the relative day, a `Confirmed` / `To confirm` pill (a word,
// not colour alone), the stage and a provenance chip saying where the date came from (MG-3).
// `Confirm` exists only for a `proposed` date and a member who may write the matter; it calls
// `confirmNextDateAction` (which checks again), announces the change and refreshes. Offline it is
// off. Without a next date the card says so; dates arrive with proceedings (#392) and lists.
import { Alert } from '@causedeck/ui/alert';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { ProvenanceChip, type ProvenanceSource } from '@causedeck/ui/patterns';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { AgreementView, ListingView, SourceView } from '../../lib/matters/workspace.ts';
import type { Result } from '../../lib/safe-action.ts';

import { useMatterAnnounce } from './matter-announcer.tsx';
import { MatterStage } from './matter-card.tsx';

export interface ChosenNextDate {
  listingId: string;
  date: string;
  confirmationState: string;
}

export type ConfirmNextDateAction = (input: {
  workspaceId: string;
  listingId: string;
}) => Promise<Result<ChosenNextDate>>;

/** A listing's source as the `ProvenanceChip` takes it, labelled in the member's language. */
export function useProvenance() {
  const t = useTranslations('matters');
  return (source: SourceView): ProvenanceSource => ({
    kind: source.kind,
    label: t(`workspace.source.${source.kind}`),
    state: source.state,
    ...(source.confidence === null ? {} : { confidence: source.confidence }),
  });
}

/** The chip's state words in the member's language. */
export function useProvenanceLabels() {
  const t = useTranslations('matters');
  return {
    confirmed: t('workspace.provenance.confirmed'),
    proposed: t('workspace.provenance.proposed'),
    edited: t('workspace.provenance.edited'),
    viewOnly: t('workspace.provenance.viewOnly'),
    offline: t('workspace.provenance.offline'),
  };
}

/**
 * How well the sources agree on a date or a stage (#499): a percentage chip whose hover (title)
 * lists every source and what it says. The status is a word, not colour alone.
 */
export function ConfidenceChip({
  agreement,
  fact,
}: {
  agreement: AgreementView;
  fact: 'date' | 'stage';
}) {
  const t = useTranslations('matters.workspace');
  const list = agreement.sources
    .map((source) => `${t(`source.${source.kind}`)}: ${source.value}`)
    .join('; ');
  return (
    <Badge
      tone={agreement.status === 'conflict' ? 'warning' : 'neutral'}
      data-confidence-chip={fact}
      data-agreement={agreement.status}
      title={`${t(`confidence.${agreement.status}`)}. ${t('confidence.sources', { list })}`}
    >
      {t('confidence.chip', { percent: agreement.percent })}
    </Badge>
  );
}

export interface NextDateCardProps {
  workspaceId: string;
  nextDate: ListingView | null;
  /** `matter.write`: `Confirm` on a proposed date. */
  canWrite: boolean;
  offline?: boolean;
  action: ConfirmNextDateAction;
}

export function NextDateCard({
  workspaceId,
  nextDate,
  canWrite,
  offline = false,
  action,
}: NextDateCardProps) {
  const t = useTranslations('matters');
  const router = useRouter();
  const announce = useMatterAnnounce();
  const provenanceOf = useProvenance();
  const labels = useProvenanceLabels();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onConfirm(listingId: string) {
    if (pending || offline) return;
    setPending(true);
    setFailed(false);
    let result: Result<ChosenNextDate>;
    try {
      result = await action({ workspaceId, listingId });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    announce(t('workspace.nextDate.announceConfirmed'));
    router.refresh();
  }

  return (
    <section
      aria-labelledby="matter-next-date-title"
      data-slot="next-date-card"
      className="border-accent bg-surface dark:border-line dark:bg-accent-soft/30 flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="matter-next-date-title" className="text-ink-muted text-sm font-medium">
        {t('workspace.nextDate.title')}
      </h2>
      {nextDate === null ? (
        <div data-next-date="none" className="flex flex-col gap-1">
          <p className="text-lg font-medium">{t('workspace.nextDate.none')}</p>
          <p className="text-ink-muted text-sm">{t('workspace.nextDate.noneBody')}</p>
        </div>
      ) : (
        <div data-next-date={nextDate.listingId} className="flex flex-col gap-2">
          <p className="text-accent text-3xl font-semibold tabular-nums">{nextDate.text}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-muted text-sm tabular-nums">{nextDate.relative}</span>
            <Badge
              tone={nextDate.proposed ? 'warning' : 'success'}
              data-confirmation={nextDate.proposed ? 'proposed' : 'confirmed'}
            >
              {nextDate.proposed ? t('nextDate.toConfirm') : t('nextDate.confirmed')}
            </Badge>
            {nextDate.dateAgreement ? (
              <ConfidenceChip agreement={nextDate.dateAgreement} fact="date" />
            ) : null}
            <MatterStage stage={nextDate.stage} />
            {nextDate.stageAgreement && nextDate.stage !== null ? (
              <ConfidenceChip agreement={nextDate.stageAgreement} fact="stage" />
            ) : null}
            <ProvenanceChip
              source={provenanceOf(nextDate.source)}
              viewOnly
              offline={offline}
              labels={labels}
            />
          </div>
          {failed ? (
            <Alert tone="danger" role="alert">
              {t('workspace.nextDate.failed')}
            </Alert>
          ) : null}
          {nextDate.proposed && canWrite ? (
            <div>
              <Button
                type="button"
                data-next-date-confirm=""
                loading={pending}
                disabled={pending || offline}
                onClick={() => void onConfirm(nextDate.listingId)}
              >
                {t('workspace.nextDate.confirm')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
