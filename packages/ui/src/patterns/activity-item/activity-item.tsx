import { CircleAlert, History, Inbox, type LucideIcon } from 'lucide-react';
import { useState, type ComponentProps } from 'react';

import { EmptyState } from '../../components/empty-state';
import { Skeleton, SkeletonGroup } from '../../components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/tooltip';
import { cn } from '../../lib/cn';
import { LevelBadge } from '../automation-level/level-badge';
import { ProvenanceChip } from '../provenance-chip/provenance-chip';
import type { Anchor, Level, Person, ProvenanceSource } from '../types';
import { UndoButton, type UndoLabels } from './undo-button';

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/** `2 days ago`, `in 3 hours`, `now`: the largest whole unit. */
export function relativeTime(at: Date, now: Date, locale = 'en-IN'): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diff = at.getTime() - now.getTime();
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= ms) return format.format(Math.trunc(diff / ms), unit);
  }
  return format.format(0, 'second');
}

export interface ActivityLabels {
  /** Shown on undone rows. */
  undone: string;
  /** Replaces Undo when the viewer may not change anything. */
  viewOnly: string;
}

export const DEFAULT_ACTIVITY_LABELS: ActivityLabels = {
  undone: 'Undone',
  viewOnly: 'View only',
};

export interface ActivityItemProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Who did it: a person, or Lawyer OS itself. */
  actor: Person;
  /** What happened, as one sentence: `Attached order dated 12 Mar to W.P. 1234/2026`. */
  sentence: string;
  source: ProvenanceSource;
  anchor?: Anchor | undefined;
  level: Level;
  /** When it happened (ISO string or Date). */
  at: Date | string;
  /** Current time, for the relative time and the undo window. Fixed in stories and tests. */
  now?: Date | undefined;
  icon?: LucideIcon | undefined;
  /** Controlled undone state; leave out to let the row track Undo and Redo itself. */
  undone?: boolean | undefined;
  defaultUndone?: boolean | undefined;
  /** Leave out to show no Undo (changes that cannot be undone). */
  onUndo?: (() => void) | undefined;
  onRedo?: (() => void) | undefined;
  onOpenSource?: (() => void) | undefined;
  /** Read-only: Undo is disabled with the reason. */
  offline?: boolean | undefined;
  /** Permission denied: Undo is hidden and a view-only note is shown. */
  viewOnly?: boolean | undefined;
  /** An error with this entry, e.g. a failed undo. */
  error?: string | undefined;
  locale?: string | undefined;
  timeZone?: string | undefined;
  labels?: Partial<ActivityLabels & UndoLabels> | undefined;
}

/**
 * Timeline row: rail, icon avatar, who did what, its source and level, when, and Undo at right.
 * Undone rows fade (icon and rail to 60%, text muted and struck through) and carry an `Undone` label.
 */
export function ActivityItem({
  actor,
  sentence,
  source,
  anchor,
  level,
  at,
  now,
  icon: Icon = History,
  undone: undoneProp,
  defaultUndone = false,
  onUndo,
  onRedo,
  onOpenSource,
  offline,
  viewOnly,
  error,
  locale = 'en-IN',
  timeZone = 'Asia/Kolkata',
  labels,
  className,
  ...props
}: ActivityItemProps) {
  const text = { ...DEFAULT_ACTIVITY_LABELS, ...labels };
  const [uncontrolled, setUncontrolled] = useState(defaultUndone);
  const undone = undoneProp ?? uncontrolled;
  const when = new Date(at);
  const current = now ?? new Date();
  const absolute = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(when);

  return (
    <div
      data-slot="activity-item"
      data-undone={undone ? '' : undefined}
      className={cn('relative flex gap-3 py-3 ps-1 font-sans', className)}
      {...props}
    >
      <span
        aria-hidden="true"
        data-slot="activity-rail"
        className={cn('bg-line absolute start-[19px] top-0 bottom-0 w-0.5', undone && 'opacity-60')}
      />
      <span
        aria-hidden="true"
        data-slot="activity-icon"
        className={cn(
          'border-line bg-surface-raised text-ink-muted relative flex size-8 shrink-0',
          'items-center justify-center rounded-full border [&_svg]:size-4',
          undone && 'opacity-60',
        )}
      >
        <Icon />
      </span>
      <div data-slot="activity-body" className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Undone: the icon and rail fade to 60%; text cannot fade that far and keep 4.5:1, so
            it drops to --ink-muted and is struck through instead. */}
        <p
          data-slot="activity-sentence"
          className={cn('text-base', undone ? 'text-ink-muted' : 'text-ink')}
        >
          <span className="sr-only">{actor.name}: </span>
          <span className={cn(undone && 'line-through')}>{sentence}</span>
        </p>
        <div className="text-ink-muted flex flex-wrap items-center gap-2 text-xs">
          <span data-slot="activity-actor">{actor.name}</span>
          <ProvenanceChip
            source={source}
            anchor={anchor}
            onOpenSource={onOpenSource}
            offline={offline}
            viewOnly={viewOnly}
          />
          <LevelBadge level={level} />
          <Tooltip>
            <TooltipTrigger asChild>
              <time
                dateTime={when.toISOString()}
                tabIndex={0}
                data-slot="activity-time"
                aria-label={absolute}
                className="focus-visible:outline-ring rounded-sm tabular-nums outline-offset-2 focus-visible:outline-2"
              >
                {relativeTime(when, current, locale)}
              </time>
            </TooltipTrigger>
            <TooltipContent data-slot="activity-time-tooltip">{absolute}</TooltipContent>
          </Tooltip>
          {undone ? (
            <span
              data-slot="activity-undone"
              className="border-line rounded-full border px-1.5 font-medium"
            >
              {text.undone}
            </span>
          ) : null}
        </div>
        {error === undefined ? null : (
          <p
            role="alert"
            data-slot="activity-error"
            className="text-danger flex items-center gap-1 text-xs [&_svg]:size-3.5"
          >
            <CircleAlert aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
      {viewOnly ? (
        <span
          data-slot="activity-view-only"
          className="text-ink-subtle shrink-0 self-start text-xs"
        >
          {text.viewOnly}
        </span>
      ) : onUndo ? (
        <UndoButton
          className="self-start"
          performedAt={at}
          now={current}
          undone={undone}
          description={sentence}
          offline={offline}
          labels={labels}
          onUndo={() => {
            if (undoneProp === undefined) setUncontrolled(true);
            onUndo();
          }}
          onRedo={() => {
            if (undoneProp === undefined) setUncontrolled(false);
            onRedo?.();
          }}
        />
      ) : null}
    </div>
  );
}

/** Placeholder rows while the timeline loads. */
export function ActivityItemSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <SkeletonGroup data-slot="activity-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3 py-3 ps-1">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}

export const ACTIVITY_EMPTY_COPY =
  'Nothing has happened yet. Forward an order or cause list to get started.';

/** The timeline before anything has happened. Calm, no exclamation. */
export function ActivityEmpty({ title = ACTIVITY_EMPTY_COPY }: { title?: string }) {
  return <EmptyState data-slot="activity-empty" icon={<Inbox />} title={title} />;
}
