import {
  AlarmClock,
  Check,
  CircleAlert,
  ClipboardCheck,
  Ellipsis,
  TriangleAlert,
} from 'lucide-react';
import { useRef, useState, type ComponentProps, type PointerEvent } from 'react';

import { Avatar } from '../../components/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/dropdown-menu';
import { EmptyState } from '../../components/empty-state';
import { IconButton } from '../../components/icon-button';
import { Skeleton, SkeletonGroup } from '../../components/skeleton';
import { useMediaQuery } from '../../hooks/use-media-query';
import { cn } from '../../lib/cn';
import { ProvenanceChip } from '../provenance-chip/provenance-chip';
import type { DueState, Person, ProvenanceSource } from '../types';

/** Touch widths get the swipe gestures; the overflow menu is there on every device. */
export const SWIPE_QUERY = '(pointer: coarse)';

/** How far (px) a row must travel before a swipe counts. */
export const SWIPE_THRESHOLD_PX = 80;
const SWIPE_MAX_PX = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of `date` in `timeZone`. */
function calendarDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(date);
}

const dayNumber = (isoDay: string) => Date.parse(`${isoDay.slice(0, 10)}T00:00:00Z`) / DAY_MS;

/** Whole calendar days from today to `due` in `timeZone`; negative when overdue. */
export function daysUntil(due: string, now: Date, timeZone = 'Asia/Kolkata'): number {
  return Math.round(dayNumber(due) - dayNumber(calendarDay(now, timeZone)));
}

export function dueState(due: string, now: Date, timeZone = 'Asia/Kolkata'): DueState {
  const days = daysUntil(due, now, timeZone);
  if (days < 0) return 'overdue';
  return days === 0 ? 'due-today' : 'upcoming';
}

const plural = (n: number, unit: string) => `${String(n)} ${unit}${n === 1 ? '' : 's'}`;

export interface ObligationLabels {
  due: (state: DueState, days: number) => string;
  done: string;
  snooze: string;
  markDone: string;
  more: (title: string) => string;
  /** Under the swipe surface for screen readers that explore by touch. */
  swipeHint: string;
  offline: string;
  viewOnly: string;
}

export const DEFAULT_OBLIGATION_LABELS: ObligationLabels = {
  due: (state, days) => {
    if (state === 'done') return 'Done';
    if (state === 'overdue') return `Overdue by ${plural(-days, 'day')}`;
    if (state === 'due-today') return 'Due today';
    return days === 1 ? 'Due tomorrow' : `Due in ${plural(days, 'day')}`;
  },
  done: 'Done',
  snooze: 'Snooze',
  markDone: 'Mark done',
  more: (title) => `More actions for ${title}`,
  swipeHint: 'Swipe left for Done, right for Snooze, or use More actions.',
  offline: 'You are offline. Actions return when you are back online.',
  viewOnly: 'View only',
};

export interface ObligationRowProps extends Omit<ComponentProps<'div'>, 'children' | 'title'> {
  title: string;
  matter?: string | undefined;
  /** Due date, `YYYY-MM-DD`. */
  due: string;
  /** Current time. Fixed in stories and tests. */
  now?: Date | undefined;
  owner: Person;
  source?: ProvenanceSource | undefined;
  done?: boolean | undefined;
  onDone?: (() => void) | undefined;
  onSnooze?: (() => void) | undefined;
  /** `auto` swipes on coarse pointers (SWIPE_QUERY); force one for previews and tests. */
  presentation?: 'auto' | 'pointer' | 'touch';
  offline?: boolean | undefined;
  viewOnly?: boolean | undefined;
  error?: string | undefined;
  locale?: string | undefined;
  timeZone?: string | undefined;
  labels?: Partial<ObligationLabels> | undefined;
}

/**
 * Work row: title, due date (tabular numerals) and due state, owner avatar and an overflow menu.
 * Overdue is a danger-soft background plus icon plus text. On touch, swipe left marks it done and
 * swipe right snoozes it; the overflow menu offers both without a gesture.
 */
export function ObligationRow({
  title,
  matter,
  due,
  now,
  owner,
  source,
  done = false,
  onDone,
  onSnooze,
  presentation = 'auto',
  offline = false,
  viewOnly = false,
  error,
  locale = 'en-IN',
  timeZone = 'Asia/Kolkata',
  labels,
  className,
  ...props
}: ObligationRowProps) {
  const text = { ...DEFAULT_OBLIGATION_LABELS, ...labels };
  const coarse = useMediaQuery(SWIPE_QUERY);
  const touch = presentation === 'auto' ? coarse : presentation === 'touch';
  const current = now ?? new Date();
  const days = daysUntil(due, current, timeZone);
  const state: DueState = done ? 'done' : dueState(due, current, timeZone);
  const overdue = state === 'overdue';
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${due.slice(0, 10)}T00:00:00Z`));
  const actionable = !viewOnly && !done;
  const swipeable = touch && actionable && !offline;

  const [offset, setOffset] = useState(0);
  const start = useRef<{ x: number; id: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!swipeable) return;
    start.current = { x: event.clientX, id: event.pointerId };
    try {
      // Keep receiving moves when the finger leaves the row. Not implemented in every environment.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The swipe still works while the pointer stays over the row.
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (start.current?.id !== event.pointerId) return;
    const dx = event.clientX - start.current.x;
    setOffset(Math.max(-SWIPE_MAX_PX, Math.min(SWIPE_MAX_PX, dx)));
  };
  const endSwipe = (event: PointerEvent<HTMLDivElement>) => {
    if (start.current?.id !== event.pointerId) return;
    const dx = event.clientX - start.current.x;
    start.current = null;
    setOffset(0);
    if (dx <= -SWIPE_THRESHOLD_PX) onDone?.();
    else if (dx >= SWIPE_THRESHOLD_PX) onSnooze?.();
  };
  const cancelSwipe = () => {
    start.current = null;
    setOffset(0);
  };

  return (
    <div
      data-slot="obligation-row"
      data-due-state={state}
      data-presentation={touch ? 'touch' : 'pointer'}
      className={cn('relative overflow-hidden rounded-lg font-sans', className)}
      {...props}
    >
      {swipeable ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-between text-sm font-medium"
        >
          <span
            data-slot="obligation-swipe-snooze"
            className={cn(
              'bg-warning-soft text-ink flex h-full items-center gap-1.5 px-4 [&_svg]:size-4',
              offset > 0 ? 'opacity-100' : 'opacity-0',
            )}
          >
            <AlarmClock />
            {text.snooze}
          </span>
          <span
            data-slot="obligation-swipe-done"
            className={cn(
              'bg-success-soft text-ink flex h-full items-center gap-1.5 px-4 [&_svg]:size-4',
              offset < 0 ? 'opacity-100' : 'opacity-0',
            )}
          >
            {text.done}
            <Check />
          </span>
        </div>
      ) : null}
      <div
        data-slot="obligation-surface"
        data-swiping={offset !== 0 ? '' : undefined}
        style={offset !== 0 ? { transform: `translateX(${String(offset)}px)` } : undefined}
        className={cn(
          'border-line relative flex min-h-11 items-center gap-3 border px-3 py-2',
          'ease-standard rounded-lg transition-transform duration-(--dur-fast)',
          'data-swiping:transition-none',
          overdue ? 'bg-danger-soft border-danger' : 'bg-surface-raised',
          done && 'opacity-60',
          swipeable && 'touch-pan-y select-none',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endSwipe}
        onPointerCancel={cancelSwipe}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn('text-ink truncate text-sm font-medium', done && 'line-through')}>
            {title}
          </span>
          {matter === undefined ? null : (
            <span className="text-ink-muted truncate text-xs">{matter}</span>
          )}
          <span
            data-slot="obligation-due"
            className={cn(
              'flex items-center gap-1 text-xs [&_svg]:size-3.5',
              overdue ? 'text-danger font-medium' : 'text-ink-muted',
            )}
          >
            {overdue ? (
              <TriangleAlert aria-hidden="true" data-slot="obligation-overdue-icon" />
            ) : null}
            <time dateTime={due.slice(0, 10)} data-slot="obligation-date" className="tabular-nums">
              {date}
            </time>
            <span aria-hidden="true">·</span>
            <span data-slot="obligation-due-text">{text.due(state, days)}</span>
          </span>
          {error === undefined ? null : (
            <span
              role="alert"
              data-slot="obligation-error"
              className="text-danger flex items-center gap-1 text-xs [&_svg]:size-3.5"
            >
              <CircleAlert aria-hidden="true" />
              {error}
            </span>
          )}
          {offline && actionable ? (
            <span data-slot="obligation-offline" className="text-ink-subtle text-xs">
              {text.offline}
            </span>
          ) : null}
          {swipeable ? <span className="sr-only">{text.swipeHint}</span> : null}
        </div>
        {source === undefined ? null : (
          <ProvenanceChip
            source={source}
            offline={offline}
            viewOnly={viewOnly}
            className="hidden sm:inline-flex"
          />
        )}
        <Avatar
          name={owner.name}
          {...(owner.avatarUrl === undefined ? {} : { src: owner.avatarUrl })}
          size="md"
          data-slot="obligation-owner"
        />
        {viewOnly ? (
          <span data-slot="obligation-view-only" className="text-ink-subtle text-xs">
            {text.viewOnly}
          </span>
        ) : actionable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                variant="ghost"
                size="sm"
                label={text.more(title)}
                data-slot="obligation-more"
                disabled={offline}
              >
                <Ellipsis />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-slot="obligation-menu-done" onSelect={() => onDone?.()}>
                <ClipboardCheck aria-hidden="true" />
                {text.markDone}
              </DropdownMenuItem>
              <DropdownMenuItem data-slot="obligation-menu-snooze" onSelect={() => onSnooze?.()}>
                <AlarmClock aria-hidden="true" />
                {text.snooze}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

/** Placeholder rows while obligations load. */
export function ObligationRowSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <SkeletonGroup data-slot="obligation-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="border-line flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2"
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="size-8 rounded-full" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

export const OBLIGATION_EMPTY_COPY = 'No open obligations. Well kept.';

/** The queue with nothing open. Calm, no exclamation. */
export function ObligationEmpty({ title = OBLIGATION_EMPTY_COPY }: { title?: string }) {
  return <EmptyState data-slot="obligation-empty" icon={<ClipboardCheck />} title={title} />;
}
