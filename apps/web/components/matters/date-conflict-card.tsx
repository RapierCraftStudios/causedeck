'use client';
// The Conflict card (#390, #40 design spec): two sources disagree on a proceeding's next date. Both
// sides stand side by side in equal columns (A: the current canonical date, B: the proposal), each
// with its date and provenance, on `warning` tokens. Nothing is preselected and nothing resolves
// itself: a member who may write the matter chooses `Choose A`, `Choose B` or a neutral `Enter
// manually` (a date from today), and `chooseNextDateSourceAction` records the choice. Readers see
// both sides without buttons. The card is a `region` labelled by its heading.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import { ProvenanceChip } from '@causedeck/ui/patterns';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import type { ConflictView, ListingView } from '../../lib/matters/workspace.ts';
import type { Result } from '../../lib/safe-action.ts';

import { useMatterAnnounce } from './matter-announcer.tsx';
import { MatterStage } from './matter-card.tsx';
import { useProvenance, useProvenanceLabels, type ChosenNextDate } from './next-date-card.tsx';

export type NextDateChoice = 'current' | 'proposed' | 'manual';

export type ChooseNextDateSourceAction = (input: {
  workspaceId: string;
  currentListingId: string;
  proposedListingId: string;
  choice: NextDateChoice;
  date?: string;
}) => Promise<Result<ChosenNextDate>>;

/** Asia/Kolkata is a fixed +05:30, with no daylight saving. */
const IST_OFFSET_MS = 330 * 60 * 1000;

/** Today in Asia/Kolkata as `YYYY-MM-DD` (the earliest manual date). */
function courtToday(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export interface DateConflictCardProps {
  workspaceId: string;
  conflict: ConflictView;
  canWrite: boolean;
  offline?: boolean;
  action: ChooseNextDateSourceAction;
}

export function DateConflictCard({
  workspaceId,
  conflict,
  canWrite,
  offline = false,
  action,
}: DateConflictCardProps) {
  const t = useTranslations('matters.workspace.conflict');
  const router = useRouter();
  const announce = useMatterAnnounce();
  const provenanceOf = useProvenance();
  const labels = useProvenanceLabels();
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [date, setDate] = useState('');
  const [dateError, setDateError] = useState<string | undefined>(undefined);
  const titleId = `${id}-title`;

  async function choose(choice: NextDateChoice, typed?: string) {
    if (pending || offline) return;
    setPending(true);
    setError(null);
    let result: Result<ChosenNextDate>;
    try {
      result = await action({
        workspaceId,
        currentListingId: conflict.current.listingId,
        proposedListingId: conflict.proposed.listingId,
        choice,
        ...(typed === undefined ? {} : { date: typed }),
      });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (result.ok) {
      const text =
        choice === 'current'
          ? conflict.current.text
          : choice === 'proposed'
            ? conflict.proposed.text
            : result.data.date;
      announce(t('announce', { date: text }));
      router.refresh();
      return;
    }
    const { code, fieldErrors } = result.error;
    if (code === 'VALIDATION' && fieldErrors?.date) setDateError(t('dateRequired'));
    else if (code === 'CONFLICT') {
      setError(t('stale'));
      router.refresh();
    } else setError(t('failed'));
  }

  function onManualSubmit(event: SyntheticEvent) {
    event.preventDefault();
    if (date === '' || date < courtToday()) {
      setDateError(t('dateRequired'));
      return;
    }
    setDateError(undefined);
    void choose('manual', date);
  }

  const side = (letter: 'A' | 'B', view: ListingView, heading: string) => (
    <div
      data-conflict-side={letter}
      className="border-line bg-surface flex flex-1 flex-col gap-2 rounded-md border p-3"
    >
      <p className="text-ink-muted text-xs font-medium">
        {letter === 'A' ? t('sideA') : t('sideB')}
      </p>
      <p className="text-lg font-semibold tabular-nums">{heading}</p>
      <div className="flex flex-wrap items-center gap-2">
        <MatterStage stage={view.stage} />
        <ProvenanceChip
          source={provenanceOf(view.source)}
          viewOnly
          offline={offline}
          labels={labels}
        />
      </div>
      {canWrite ? (
        <Button
          type="button"
          variant="secondary"
          data-conflict-choose={letter}
          disabled={pending || offline}
          onClick={() => void choose(letter === 'A' ? 'current' : 'proposed')}
        >
          {letter === 'A' ? t('chooseA') : t('chooseB')}
        </Button>
      ) : null}
    </div>
  );

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      data-slot="date-conflict-card"
      data-conflict={conflict.proceedingId}
      className="border-warning bg-warning-soft flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="text-base font-medium">
          {t('title')}
        </h2>
        <p className="text-ink-muted text-sm">{t('body')}</p>
      </div>
      <div className="flex flex-col gap-3 md:flex-row">
        {side('A', conflict.current, t('current', { date: conflict.current.text }))}
        {side('B', conflict.proposed, t('proposed', { date: conflict.proposed.text }))}
      </div>
      {error === null ? null : (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {canWrite ? (
        manual ? (
          <form noValidate className="flex flex-wrap items-end gap-3" onSubmit={onManualSubmit}>
            <Field label={t('manualDate')} error={dateError}>
              <Input
                type="date"
                data-conflict-date=""
                min={courtToday()}
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                }}
              />
            </Field>
            <Button type="submit" loading={pending} disabled={pending || offline}>
              {t('save')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setManual(false);
                setDateError(undefined);
              }}
            >
              {t('cancel')}
            </Button>
          </form>
        ) : (
          <div>
            <Button
              type="button"
              variant="ghost"
              data-conflict-manual=""
              disabled={pending || offline}
              onClick={() => {
                setManual(true);
              }}
            >
              {t('manual')}
            </Button>
          </div>
        )
      ) : null}
    </section>
  );
}
