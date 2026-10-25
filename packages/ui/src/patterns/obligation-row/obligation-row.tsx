import {
  AlarmClock,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardCheck,
  Ellipsis,
  FileText,
  Gavel,
  ListChecks,
  Scale,
  ScrollText,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { motion } from 'motion/react';
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
import { useReducedMotion } from '../../hooks/use-reduced-motion';
import { cn } from '../../lib/cn';
import { ProvenanceChip } from '../provenance-chip/provenance-chip';
import type { DueState, Person, ProvenanceSource } from '../types';

/** Touch widths get the swipe gestures; the overflow menu is there on every device. */
export const SWIPE_QUERY = '(pointer: coarse)';

/** How far (px) a row must travel before a swipe counts. */
export const SWIPE_THRESHOLD_PX = 72;
/** Group reflow and reorder (#68): 220 ms, instant (a 100 ms fade) under reduced motion. */
export const LAYOUT_MS = 220;
export const REDUCED_FADE_MS = 100;

/** What an obligation is, as the queue draws it: the icon of its kind. */
export type ObligationKind =
  | 'order_direction'
  | 'rule'
  | 'registry_defect'
  | 'client'
  | 'internal'
  | 'certified_copy';

const KIND_ICONS = {
  order_direction: Gavel,
  rule: Scale,
  registry_defect: ScrollText,
  client: UserRound,
  internal: ListChecks,
  certified_copy: FileText,
} as const;
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
  reschedule: string;
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
  reschedule: 'Reschedule',
  markDone: 'Mark done',
  more: (title) => `More actions for ${title}`,
  swipeHint: 'Swipe right for Done, left to Reschedule, or use More actions.',
  offline: 'You are offline. Actions return when you are back online.',
  viewOnly: 'View only',
};

export interface ObligationRowProps extends Omit<ComponentProps<'div'>, 'children' | 'title'> {
  title: string;
  matter?: string | undefined;
  /** Due date, `YYYY-MM-DD`; empty for an undated task. */
  due: string;
  /** Current time. Fixed in stories and tests. */
  now?: Date | undefined;
  owner: Person;
  source?: ProvenanceSource | undefined;
  done?: boolean | undefined;
  onDone?: (() => void) | undefined;
  /** Opens the reschedule step (a date and a reason). */
  onReschedule?: (() => void) | undefined;
  /** @deprecated Use `onReschedule`. */
  onSnooze?: (() => void) | undefined;
  /** The obligation's kind: its icon, with `kindLabel` as the accessible name. */
  kind?: ObligationKind | undefined;
  kindLabel?: string | undefined;
  /** The case number under the matter, e.g. `WP 1234/2026`. */
  caseNumber?: string | undefined;
  /** The status in words (`Open`); shown beside the due text. */
  statusLabel?: string | undefined;
  selected?: boolean | undefined;
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
  onReschedule,
  onSnooze,
  kind,
  kindLabel,
  caseNumber,
  statusLabel,
  selected = false,
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
  const reduced = useReducedMotion();
  const reschedule = onReschedule ?? onSnooze;
  const KindIcon = kind === undefined ? null : KIND_ICONS[kind];
  const coarse = useMediaQuery(SWIPE_QUERY);
  const touch = presentation === 'auto' ? coarse : presentation === 'touch';
  const current = now ?? new Date();
  // An empty `due` is an undated task: no date, no relative text from the calendar.
  const undated = due === '';
  const days = undated ? 0 : daysUntil(due, current, timeZone);
  const state: DueState = done ? 'done' : undated ? 'upcoming' : dueState(due, current, timeZone);
  const overdue = state === 'overdue';
  const date = undated
    ? ''
    : new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(due.slice(0, 4) === calendarDay(current, timeZone).slice(0, 4) ? {} : { year: 'numeric' }),
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
    // Right opens Done (the close dialog, which asks for a reason); left opens Reschedule.
    if (dx >= SWIPE_THRESHOLD_PX) onDone?.();
    else if (dx <= -SWIPE_THRESHOLD_PX) reschedule?.();
  };
  const cancelSwipe = () => {
    start.current = null;
    setOffset(0);
  };

  return (
    <motion.div
      data-slot="obligation-row"
      data-due-state={state}
      data-selected={selected ? '' : undefined}
      layout={reduced ? false : 'position'}
      transition={{ layout: { duration: LAYOUT_MS / 1000, ease: [0.2, 0, 0, 1] } }}
      {...(reduced
        ? {
            initial: { opacity: 0 },
            animate: { opacity: 1, transition: { duration: REDUCED_FADE_MS / 1000 } },
          }
        : {})}
      data-presentation={touch ? 'touch' : 'pointer'}
      className={cn(
        'relative overflow-hidden rounded-lg font-sans',
        selected && 'ring-focus ring-2',
        className,
      )}
      {...(props as object)}
    >
      {swipeable ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-between text-sm font-medium"
        >
          <span
            data-slot="obligation-swipe-done"
            className={cn(
              'bg-success-soft text-ink flex h-full items-center gap-1.5 px-4 [&_svg]:size-4',
              offset > 0 ? 'opacity-100' : 'opacity-0',
            )}
          >
            <Check />
            {text.done}
          </span>
          <span
            data-slot="obligation-swipe-reschedule"
            className={cn(
              'bg-info-soft text-ink flex h-full items-center gap-1.5 px-4 [&_svg]:size-4',
              offset < 0 ? 'opacity-100' : 'opacity-0',
            )}
          >
            {text.reschedule}
            <AlarmClock />
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
          <span
            className={cn('text-ink text-sm font-medium wrap-break-word', done && 'line-through')}
          >
            {title}
          </span>
          {matter === undefined ? null : (
            <span data-slot="obligation-matter" className="text-ink-muted text-xs wrap-break-word">
              {matter}
              {caseNumber === undefined ? null : (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="tabular-nums">{caseNumber}</span>
                </>
              )}
            </span>
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
            {undated ? null : (
              <>
                <time
                  dateTime={due.slice(0, 10)}
                  data-slot="obligation-date"
                  className="tabular-nums"
                >
                  {date}
                </time>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span data-slot="obligation-due-text">{text.due(state, days)}</span>
            {KindIcon === null ? null : (
              <KindIcon
                role={kindLabel === undefined ? undefined : 'img'}
                aria-label={kindLabel}
                aria-hidden={kindLabel === undefined ? true : undefined}
                data-slot="obligation-kind"
              />
            )}
            {statusLabel === undefined ? null : (
              <span data-slot="obligation-status" className="text-ink-subtle">
                · {statusLabel}
              </span>
            )}
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
              <DropdownMenuItem data-slot="obligation-menu-reschedule" onSelect={() => reschedule?.()}>
                <AlarmClock aria-hidden="true" />
                {text.reschedule}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </motion.div>
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

export interface GroupHeaderProps extends Omit<ComponentProps<'button'>, 'children'> {
  label: string;
  count: number;
  collapsed?: boolean | undefined;
  /** The overdue group shows an icon with its label, never colour alone. */
  overdue?: boolean | undefined;
}

/** The sticky header of a queue group: label, count and the collapse toggle. */
export function GroupHeader({
  label,
  count,
  collapsed = false,
  overdue = false,
  className,
  ...props
}: GroupHeaderProps) {
  return (
    <button
      type="button"
      data-slot="obligation-group-header"
      aria-expanded={!collapsed}
      className={cn(
        'bg-surface text-ink focus-visible:ring-focus sticky top-0 z-10 flex min-h-11 w-full items-center gap-2 px-1 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      <ChevronDown
        aria-hidden="true"
        className={cn('size-4 transition-transform', collapsed && '-rotate-90')}
      />
      {overdue ? <TriangleAlert aria-hidden="true" className="text-danger size-4" /> : null}
      <span>{label}</span>
      <span className="text-ink-muted tabular-nums">{String(count)}</span>
    </button>
  );
}
