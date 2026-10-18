'use client';

import { enIN } from 'date-fns/locale/en-IN';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import {
  DayPicker,
  labelDayButton,
  type ChevronProps,
  type DayPickerProps,
  type Matcher,
} from 'react-day-picker';

import { cn } from '../../lib/cn';

/** Calendar maths and the dates handed back run in India Standard Time by default. */
export const IST_TIME_ZONE = 'Asia/Kolkata';

export interface CalendarLabels {
  previousMonth: string;
  nextMonth: string;
  /** Appended to a holiday's accessible name, e.g. "12 March 2026, Court holiday". */
  holiday: string;
}

export const DEFAULT_CALENDAR_LABELS: CalendarLabels = {
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  holiday: 'Court holiday',
};

export type CalendarProps = DayPickerProps & {
  /**
   * Court holidays to decorate (a dot under the day plus an accessible "Court holiday" suffix).
   * Takes react-day-picker matchers: dates, ranges, weekdays or a predicate. Data arrives later.
   */
  holidays?: Matcher | Matcher[] | undefined;
  /** Name of the holiday on `date` (e.g. "Ugadi"), added to its accessible name and tooltip. */
  getHolidayName?: ((date: Date) => string | undefined) | undefined;
  labels?: Partial<CalendarLabels> | undefined;
};

const ICONS = { left: ChevronLeft, right: ChevronRight, up: ChevronUp, down: ChevronDown };

function CalendarChevron({ orientation = 'left', className }: ChevronProps) {
  const Icon = ICONS[orientation];
  return <Icon aria-hidden="true" className={cn('size-4', className)} />;
}

const navButton = cn(
  'inline-flex size-8 items-center justify-center rounded-md text-ink-muted',
  'hover:bg-surface-sunken hover:text-ink',
  'outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'pointer-coarse:size-11',
);

/**
 * Month grid on react-day-picker: Monday-first weeks, IST, token styles, no motion. Keyboard from
 * react-day-picker: arrows move by day and week, Home/End to the week's ends, PageUp/PageDown by
 * month (Shift for year), Enter or Space selects.
 */
export function Calendar({
  holidays,
  getHolidayName,
  labels,
  className,
  classNames,
  modifiers,
  modifiersClassNames,
  showOutsideDays = true,
  weekStartsOn = 1,
  timeZone = IST_TIME_ZONE,
  locale = enIN,
  components,
  ...props
}: CalendarProps) {
  const text = { ...DEFAULT_CALENDAR_LABELS, ...labels };
  return (
    <DayPicker
      data-slot="calendar"
      showOutsideDays={showOutsideDays}
      weekStartsOn={weekStartsOn}
      timeZone={timeZone}
      locale={locale}
      animate={false}
      className={cn('text-ink w-fit p-3 font-sans text-sm', className)}
      labels={{
        labelPrevious: () => text.previousMonth,
        labelNext: () => text.nextMonth,
        labelDayButton: (date, dayModifiers, options, dateLib) => {
          const base = labelDayButton(date, dayModifiers, options, dateLib);
          if (!dayModifiers['holiday']) return base;
          const name = getHolidayName?.(date);
          return name ? `${base}, ${text.holiday}: ${name}` : `${base}, ${text.holiday}`;
        },
      }}
      modifiers={{ ...modifiers, ...(holidays === undefined ? {} : { holiday: holidays }) }}
      modifiersClassNames={{
        holiday: cn(
          'relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-1',
          'after:mx-auto after:size-1 after:rounded-full after:bg-warning',
          'forced-colors:after:bg-current',
        ),
        ...modifiersClassNames,
      }}
      classNames={{
        months: 'relative flex flex-col gap-4 sm:flex-row',
        month: 'grid gap-3',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous: navButton,
        button_next: navButton,
        month_caption: 'flex h-8 items-center justify-center px-10',
        caption_label: 'text-sm font-medium',
        month_grid: 'w-full border-collapse',
        weekdays: '',
        weekday: 'size-9 text-xs font-normal text-ink-muted',
        week: '',
        day: 'p-0 text-center tabular-nums',
        day_button: cn(
          'inline-flex size-9 items-center justify-center rounded-md',
          'hover:bg-surface-sunken',
          'outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
          'disabled:cursor-not-allowed',
          'forced-colors:border forced-colors:border-transparent',
        ),
        selected: cn(
          '[&>button]:bg-accent [&>button]:text-accent-ink [&>button]:hover:bg-accent',
          'forced-colors:[&>button]:border-current',
        ),
        today: '[&>button]:font-semibold [&>button]:underline [&>button]:underline-offset-4',
        outside: 'text-ink-subtle',
        disabled: 'text-ink-subtle opacity-50',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{ Chevron: CalendarChevron, ...components }}
      {...props}
    />
  );
}
