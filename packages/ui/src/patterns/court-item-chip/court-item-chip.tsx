import { Moon, Sun, Sunrise, type LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Skeleton } from '../../components/skeleton';
import { cn } from '../../lib/cn';
import { ProvenanceChip } from '../provenance-chip/provenance-chip';
import { StageBadge } from '../stage-badge/stage-badge';
import { STAGE_MAP } from '../stage-badge/stage-map';
import type { Anchor, ProvenanceSource, Stage } from '../types';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

/** Court sittings: before lunch, after lunch, and late (after 17:00). `time` is `HH:mm`. */
export function timeOfDay(time: string): TimeOfDay {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const total = hours * 60 + minutes;
  if (total < 13 * 60) return 'morning';
  return total < 17 * 60 ? 'afternoon' : 'evening';
}

export const TIME_OF_DAY_ICONS: Record<TimeOfDay, LucideIcon> = {
  morning: Sunrise,
  afternoon: Sun,
  evening: Moon,
};

export interface CourtItemLabels {
  item: (itemNo: number | string) => string;
  timeOfDay: Record<TimeOfDay, string>;
}

export const DEFAULT_COURT_ITEM_LABELS: CourtItemLabels = {
  item: (itemNo) => `Item ${String(itemNo)}`,
  timeOfDay: { morning: 'Before lunch', afternoon: 'After lunch', evening: 'Evening' },
};

export interface CourtItemChipProps extends Omit<ComponentProps<'div'>, 'children' | 'onSelect'> {
  /** Cause-list item number. */
  itemNo: number | string;
  /** Court hall or bench, as the cause list prints it. */
  hall: string;
  stage: Stage;
  /** Listing time, `HH:mm` (24 h). */
  time?: string | undefined;
  /** Where the listing came from (cause list, order). */
  source?: ProvenanceSource | undefined;
  anchor?: Anchor | undefined;
  /** Makes the chip a button, e.g. to open the matter. */
  onSelect?: (() => void) | undefined;
  onOpenSource?: (() => void) | undefined;
  stageLabel?: string | undefined;
  labels?: Partial<CourtItemLabels> | undefined;
}

/** Cause-list item: number, hall, stage and time with a time-of-day cue, plus its source. */
export function CourtItemChip({
  itemNo,
  hall,
  stage,
  time,
  source,
  anchor,
  onSelect,
  onOpenSource,
  stageLabel,
  labels,
  className,
  ...props
}: CourtItemChipProps) {
  const text = {
    ...DEFAULT_COURT_ITEM_LABELS,
    ...labels,
    timeOfDay: { ...DEFAULT_COURT_ITEM_LABELS.timeOfDay, ...labels?.timeOfDay },
  };
  const cue = time === undefined ? undefined : timeOfDay(time);
  const CueIcon = cue === undefined ? undefined : TIME_OF_DAY_ICONS[cue];
  const name = [
    text.item(itemNo),
    hall,
    stageLabel ?? STAGE_MAP[stage].label,
    time === undefined || cue === undefined ? undefined : `${time}, ${text.timeOfDay[cue]}`,
  ]
    .filter(Boolean)
    .join(', ');

  // Spoken separators, so the button's name (its visible text) reads like `name`.
  const comma = <span className="sr-only">, </span>;
  const content = (
    <>
      <span data-slot="court-item-no" className="text-ink font-medium tabular-nums">
        {text.item(itemNo)}
      </span>
      <span aria-hidden="true" className="text-ink-subtle">
        ·
      </span>
      {comma}
      <span data-slot="court-item-hall" className="min-w-0 wrap-break-word">
        {hall}
      </span>
      {comma}
      <StageBadge stage={stage} label={stageLabel ?? STAGE_MAP[stage].label} />
      {time === undefined || cue === undefined || CueIcon === undefined ? null : (
        <>
          {comma}
          <span
            data-slot="court-item-time"
            data-time-of-day={cue}
            title={text.timeOfDay[cue]}
            className="inline-flex items-center gap-1 tabular-nums [&_svg]:size-3.5"
          >
            <CueIcon aria-hidden="true" />
            {time}
            <span className="sr-only">, {text.timeOfDay[cue]}</span>
          </span>
        </>
      )}
    </>
  );
  const row = 'inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-start';

  return (
    <div
      data-slot="court-item-chip"
      data-stage={stage}
      className={cn(
        'border-line bg-surface-raised text-ink-muted inline-flex max-w-full flex-wrap items-center gap-2',
        'rounded-full border py-1 ps-3 pe-1.5 font-sans text-sm forced-colors:border-current',
        className,
      )}
      {...props}
    >
      {onSelect ? (
        <button
          type="button"
          data-slot="court-item-select"
          onClick={onSelect}
          className={cn(
            row,
            'focus-visible:outline-ring rounded-full outline-offset-2 focus-visible:outline-2',
            'pointer-coarse:min-h-11',
          )}
        >
          {content}
        </button>
      ) : (
        <span role="group" aria-label={name} className={row}>
          {content}
        </span>
      )}
      {source === undefined ? null : (
        <ProvenanceChip source={source} anchor={anchor} onOpenSource={onOpenSource} />
      )}
    </div>
  );
}

/** Placeholder while the cause list loads. */
export function CourtItemChipSkeleton() {
  return <Skeleton data-slot="court-item-skeleton" className="h-8 w-64 rounded-full" />;
}
