'use client';
// One proceeding of a proposed matter (#551): its case number, or "Unnumbered" for a stage that has
// none yet (an SR-stage filing), and a native select to move it to another matter.
import { Badge } from '@causedeck/ui/badge';
import type { PlanProceeding } from '@causedeck/core/import';
import { useTranslations } from 'next-intl';

export interface MoveTarget {
  tempId: string;
  title: string;
}

export interface ProceedingChipProps {
  proceeding: PlanProceeding;
  /** The other matters it can move to; empty hides the move control. */
  targets: readonly MoveTarget[];
  onMove: (key: string, toId: string) => void;
}

export const proceedingName = (p: PlanProceeding): string => p.label ?? p.cnr ?? p.key;

export function ProceedingChip({ proceeding, targets, onMove }: ProceedingChipProps) {
  const t = useTranslations('importReview');
  const name = proceedingName(proceeding);
  return (
    <li
      data-slot="proceeding-chip"
      data-proceeding-key={proceeding.key}
      className="border-line bg-surface-sunken flex flex-wrap items-center gap-2 rounded-full border px-3 py-1 text-sm"
    >
      <span className="text-ink font-medium">{name}</span>
      {proceeding.caseNumber === null ? <Badge tone="outline">{t('grid.unnumbered')}</Badge> : null}
      {targets.length > 0 ? (
        <select
          aria-label={t('grid.moveLabel', { label: name })}
          value=""
          className="border-line bg-surface text-ink-muted h-7 rounded-sm border px-1 text-xs pointer-coarse:h-11"
          onChange={(event) => {
            if (event.target.value !== '') onMove(proceeding.key, event.target.value);
          }}
        >
          <option value="">{t('grid.moveTo')}</option>
          {targets.map((target) => (
            <option key={target.tempId} value={target.tempId}>
              {target.title}
            </option>
          ))}
        </select>
      ) : null}
    </li>
  );
}
