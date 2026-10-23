'use client';
// One proposed matter in the confirm grid (#551): include checkbox, inline-editable title,
// forum, stage, next date with its Provenance Chip, source count, confidence and issue icons;
// expands to its proceedings. A conflict between sources blocks the row until a date is picked.
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Checkbox } from '@causedeck/ui/checkbox';
import { ProvenanceChip, type ProvenanceSource } from '@causedeck/ui/patterns';
import { AlertTriangle, ChevronDown, ChevronRight, GitCompare } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import type { PreviewMatter } from '../../lib/import/plan-edit.ts';

import { MergeSplitControls } from './merge-split-controls.tsx';
import { ProceedingChip, type MoveTarget } from './proceeding-chip.tsx';

export interface MatterGroupRowProps {
  matter: PreviewMatter;
  index: number;
  total: number;
  active: boolean;
  included: boolean;
  expanded: boolean;
  /** Dates picked for conflicting proceedings, by proceeding key. */
  resolved: Readonly<Record<string, string>>;
  targets: readonly MoveTarget[];
  canMerge: boolean;
  disabled: boolean;
  registerTitle: (el: HTMLInputElement | null) => void;
  onActivate: () => void;
  onToggleInclude: () => void;
  onToggleExpand: () => void;
  onRename: (title: string) => void;
  onPickDate: (proceedingKey: string, date: string) => void;
  onMove: (proceedingKey: string, toId: string) => void;
  onMerge: () => void;
  onSplit: () => void;
  onFocusTitle: () => void;
}

export function MatterGroupRow({
  matter,
  index,
  total,
  active,
  included,
  expanded,
  resolved,
  targets,
  canMerge,
  disabled,
  registerTitle,
  onActivate,
  onToggleInclude,
  onToggleExpand,
  onRename,
  onPickDate,
  onMove,
  onMerge,
  onSplit,
  onFocusTitle,
}: MatterGroupRowProps) {
  const t = useTranslations('bootstrapImport');
  const format = useFormatter();
  const day = (date: string) =>
    format.dateTime(new Date(`${date}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });
  const first = matter.proceedings[0];
  const blocked = included && matter.open.length > 0;
  const lowConfidence = matter.issues.some((i) => i.code === 'low_confidence');
  const hasConflict = matter.issues.some((i) => i.code === 'conflicting_dates');
  const picked = matter.proceedings.some((p) => resolved[p.key] !== undefined);
  const source: ProvenanceSource = {
    kind: 'import',
    label: t('provenance.label'),
    state: picked ? 'edited' : 'proposed',
    confidence: matter.confidence,
  };
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <li
      data-slot="matter-row"
      data-matter-id={matter.tempId}
      data-active={active ? '' : undefined}
      data-blocked={blocked ? '' : undefined}
      aria-current={active ? 'true' : undefined}
      aria-label={t('grid.active', { title: matter.title, index: index + 1, total })}
      onFocusCapture={onActivate}
      onClick={onActivate}
      className="border-line bg-surface data-[active]:border-seal data-[blocked]:border-danger rounded-md border p-3 transition-colors duration-(--dur-fast) motion-reduce:transition-none"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Checkbox
          checked={included}
          disabled={disabled}
          aria-label={t('grid.include', { title: matter.title })}
          onCheckedChange={onToggleInclude}
        />
        <input
          key={matter.title}
          ref={registerTitle}
          aria-label={t('grid.title')}
          defaultValue={matter.title}
          disabled={disabled}
          className="text-ink hover:border-line focus-visible:border-seal min-w-40 flex-1 rounded-sm border border-transparent bg-transparent px-1 font-medium"
          onBlur={(event) => {
            const title = event.target.value.trim();
            if (title !== '' && title !== matter.title) onRename(title);
            else event.target.value = matter.title;
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              event.currentTarget.value = matter.title;
              event.currentTarget.blur();
            }
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-label={expanded ? t('grid.collapse') : t('grid.expand')}
          onClick={onToggleExpand}
        >
          <Chevron aria-hidden />
        </Button>
      </div>
      <dl className="text-ink-muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <div className="flex gap-1">
          <dt className="sr-only">{t('grid.forum')}</dt>
          <dd>{first?.forumCode ?? t('grid.noForum')}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="sr-only">{t('grid.stage')}</dt>
          <dd>{first?.stage ?? t('grid.noStage')}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="sr-only">{t('grid.nextDate')}</dt>
          <dd className="flex items-center gap-2">
            {matter.nextDate === null ? (
              t('grid.noNextDate')
            ) : (
              <>
                <time dateTime={matter.nextDate.date}>{day(matter.nextDate.date)}</time>
                <ProvenanceChip source={source} viewOnly />
              </>
            )}
          </dd>
        </div>
        <span>{t('grid.sources', { count: matter.sources.length })}</span>
        <span>{t('grid.confidence', { percent: Math.round(matter.confidence * 100) })}</span>
        {lowConfidence ? (
          <AlertTriangle
            aria-label={t('grid.lowConfidence')}
            role="img"
            className="text-warning size-4"
          />
        ) : null}
        {hasConflict ? (
          <GitCompare aria-label={t('grid.conflict')} role="img" className="text-danger size-4" />
        ) : null}
      </dl>
      {matter.issues.some((i) => i.blocking) ? (
        <ConflictPicker matter={matter} resolved={resolved} day={day} onPick={onPickDate} />
      ) : null}
      {expanded ? (
        <ul aria-label={t('grid.proceedings')} className="mt-3 flex flex-wrap gap-2">
          {matter.proceedings.map((p) => (
            <ProceedingChip key={p.key} proceeding={p} targets={targets} onMove={onMove} />
          ))}
        </ul>
      ) : null}
      <div className="mt-2">
        <MergeSplitControls
          canMerge={canMerge}
          canSplit={matter.proceedings.length > 1}
          onRename={onFocusTitle}
          onMerge={onMerge}
          onSplit={onSplit}
        />
      </div>
    </li>
  );
}

function ConflictPicker({
  matter,
  resolved,
  day,
  onPick,
}: {
  matter: PreviewMatter;
  resolved: Readonly<Record<string, string>>;
  day: (date: string) => string;
  onPick: (key: string, date: string) => void;
}) {
  const t = useTranslations('bootstrapImport');
  return (
    <div role="group" aria-label={t('conflict.title')} className="mt-2 flex flex-col gap-2">
      {matter.issues
        .filter((i) => i.blocking && i.proceedingKey !== undefined)
        .map((issue) => {
          const key = issue.proceedingKey as string;
          const choice = resolved[key];
          return (
            <div key={key} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={choice === undefined ? 'danger' : 'success'}>
                {choice === undefined
                  ? t('conflict.blocked')
                  : t('conflict.picked', { date: day(choice) })}
              </Badge>
              {(issue.dates ?? []).map((date) => (
                <Button
                  key={date}
                  type="button"
                  size="sm"
                  variant={choice === date ? 'primary' : 'outline'}
                  aria-pressed={choice === date}
                  onClick={() => {
                    onPick(key, date);
                  }}
                >
                  {t('conflict.pick', { date: day(date) })}
                </Button>
              ))}
            </div>
          );
        })}
    </div>
  );
}
