'use client';
// The inbox Conflict Card (#48): the confirmed date and the proposed date side by side, each with
// its source chip, on `warning` tokens. Nothing is preselected. `Keep current` dismisses the
// proposal, `Use proposed` accepts it and `Enter another` accepts it with the date the person
// typed; each applies to this one proceeding, and there is no "confirm all" for conflicts.
import { formatDate, type Locale } from '@causedeck/i18n';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { ProvenanceChip } from '@causedeck/ui/patterns';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import type { InboxItemView } from '../../../lib/inbox/view.ts';

export interface DateConflictProps {
  item: InboxItemView;
  locale: Locale;
  /** Every action off: offline or saving. */
  disabled: boolean;
  disabledReason?: string | undefined;
  readOnly: boolean;
  error?: string | undefined;
  onKeep: () => void;
  onUse: () => void;
  onOther: (date: string) => void;
}

const dateOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export function DateConflict({
  item,
  locale,
  disabled,
  disabledReason,
  readOnly,
  error,
  onKeep,
  onUse,
  onOther,
}: DateConflictProps) {
  const t = useTranslations('inbox');
  const titleId = useId();
  const [entering, setEntering] = useState(false);
  const [other, setOther] = useState('');
  const proposed = dateOf(item.payload?.['date']);
  const anchor = item.anchors[0];

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (other !== '') onOther(other);
  };
  const fmt = (date: string | null) =>
    date === null ? t('card.noValue') : formatDate(date, { locale });

  return (
    <article
      aria-labelledby={titleId}
      data-proposal-id={item.id}
      data-phase="idle"
      data-slot="conflict-card"
      tabIndex={0}
      className="bg-surface-raised border-warning focus-visible:outline-ring grid gap-3 rounded-xl border p-4 outline-offset-2 focus-visible:outline-2"
    >
      <h3 id={titleId} className="text-ink flex items-center gap-2 font-serif text-lg">
        <TriangleAlert aria-hidden="true" className="text-warning size-4 shrink-0" />
        {t('conflict.title')}
      </h3>
      {item.matterTitle === null ? null : (
        <p className="text-ink-muted text-sm">
          {item.caseNumber === null
            ? item.matterTitle
            : t('card.matter', { matter: item.matterTitle, caseNumber: item.caseNumber })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <section
          className="bg-warning-soft grid gap-2 rounded-lg p-3"
          aria-label={t('conflict.current')}
        >
          <p className="text-ink-muted text-xs">{t('conflict.current')}</p>
          <p className="font-serif text-xl tabular-nums">{fmt(item.currentDate)}</p>
          <ProvenanceChip
            source={{ kind: 'system', label: t('conflict.current'), state: 'confirmed' }}
            viewOnly={readOnly}
          />
        </section>
        <section
          className="bg-warning-soft grid gap-2 rounded-lg p-3"
          aria-label={t('conflict.proposed')}
        >
          <p className="text-ink-muted text-xs">{t('conflict.proposed')}</p>
          <p className="font-serif text-xl tabular-nums">{fmt(proposed)}</p>
          <ProvenanceChip
            source={{
              kind: 'capture',
              label:
                anchor === undefined
                  ? t('conflict.proposed')
                  : t('preview.page', { page: anchor.page }),
              state: 'proposed',
              ...(anchor === undefined
                ? {}
                : { quote: anchor.quote, page: anchor.page, anchorId: anchor.id }),
              ...(item.confidence === null ? {} : { confidence: item.confidence }),
            }}
            viewOnly={readOnly}
          />
        </section>
      </div>
      <p className="text-ink-muted text-xs">{t('conflict.oneProceeding')}</p>
      {error ? (
        <p role="alert" className="text-danger bg-danger-soft rounded-md px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}
      {readOnly ? (
        <p className="text-ink-muted text-xs">{t('readOnly')}</p>
      ) : entering ? (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            <span>{t('conflict.otherLabel')}</span>
            <Input
              type="date"
              value={other}
              onChange={(event) => {
                setOther(event.target.value);
              }}
              required
              disabled={disabled}
              className="pointer-coarse:min-h-11"
            />
          </label>
          <Button type="submit" disabled={disabled || other === ''} title={disabledReason}>
            {t('conflict.apply')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEntering(false);
            }}
          >
            {t('card.cancel')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={disabled}
            title={disabledReason}
            onClick={onKeep}
            className="pointer-coarse:min-h-11"
          >
            {t('conflict.keep')}
          </Button>
          <Button
            disabled={disabled}
            title={disabledReason}
            onClick={onUse}
            className="pointer-coarse:min-h-11"
          >
            {t('conflict.use')}
          </Button>
          <Button
            variant="ghost"
            disabled={disabled}
            title={disabledReason}
            onClick={() => {
              setEntering(true);
            }}
            className="pointer-coarse:min-h-11"
          >
            {t('conflict.other')}
          </Button>
        </div>
      )}
    </article>
  );
}
