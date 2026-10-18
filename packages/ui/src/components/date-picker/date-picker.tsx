'use client';

import { TZDate } from '@date-fns/tz';
import { format, isValid, parse } from 'date-fns';
import { enIN } from 'date-fns/locale/en-IN';
import { CalendarDays } from 'lucide-react';
import type { Matcher } from 'react-day-picker';
import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';

import { cn } from '../../lib/cn';
import {
  Calendar,
  DEFAULT_CALENDAR_LABELS,
  IST_TIME_ZONE,
  type CalendarLabels,
} from '../calendar/calendar';
import { useFieldControl } from '../field/field';
import { IconButton } from '../icon-button/icon-button';
import { Input, type InputProps } from '../input/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../popover/popover';

/** Display format: `12 Mar 2026`. */
export const DISPLAY_DATE_FORMAT = 'dd MMM yyyy';

/** `date` as `dd MMM yyyy` on the calendar of `timeZone` (IST by default). */
export function formatDisplayDate(date: Date, timeZone: string = IST_TIME_ZONE): string {
  return format(new TZDate(date, timeZone), DISPLAY_DATE_FORMAT, { locale: enIN });
}

const NUMERIC_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

function calendarDate(year: number, month: number, day: number, timeZone: string): Date | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  // A plain Date for the instant (TZDate would serialise with an offset).
  return new Date(new TZDate(year, month - 1, day, timeZone).getTime());
}

/**
 * Parse typed input as a calendar day at midnight in `timeZone` (IST by default), whatever the
 * device's zone. Accepts `dd/mm/yyyy` (also `-` or `.` separators, single-digit day or month) and
 * the display format `dd MMM yyyy`. Returns `null` for anything else or an impossible date.
 */
export function parseDateInput(text: string, timeZone: string = IST_TIME_ZONE): Date | null {
  const value = text.trim();
  if (!value) return null;
  const numeric = NUMERIC_DATE.exec(value);
  if (numeric) {
    return calendarDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]), timeZone);
  }
  const named = parse(value, 'd MMM yyyy', new Date(2000, 0, 1), { locale: enIN });
  if (!isValid(named)) return null;
  return calendarDate(named.getFullYear(), named.getMonth() + 1, named.getDate(), timeZone);
}

export interface DatePickerLabels extends CalendarLabels {
  /** Input placeholder showing the typed format. */
  placeholder: string;
  /** Accessible name of the calendar button. */
  openCalendar: string;
  /** Accessible name of the calendar popover. */
  calendar: string;
  /** Shown under the input when the typed text is not a date. */
  invalid: string;
}

export const DEFAULT_DATE_PICKER_LABELS: DatePickerLabels = {
  ...DEFAULT_CALENDAR_LABELS,
  placeholder: 'dd/mm/yyyy',
  openCalendar: 'Choose date',
  calendar: 'Calendar',
  invalid: 'Enter a date as dd/mm/yyyy, for example 12/03/2026.',
};

export interface DatePickerProps extends Omit<
  InputProps,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'labels'
> {
  value?: Date | null | undefined;
  defaultValue?: Date | null | undefined;
  /** Called with the committed date (`null` when cleared) on blur, Enter or a calendar pick. */
  onChange?: ((date: Date | null) => void) | undefined;
  /** Court holidays to decorate in the calendar (prop only; data arrives later). */
  holidays?: Matcher | Matcher[] | undefined;
  getHolidayName?: ((date: Date) => string | undefined) | undefined;
  /** Days that cannot be picked. */
  disabledDays?: Matcher | Matcher[] | undefined;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | undefined;
  /** Zone for parsing and the calendar (default `Asia/Kolkata`). */
  timeZone?: string | undefined;
  labels?: Partial<DatePickerLabels> | undefined;
}

/**
 * Date input with a calendar popover. Shows `dd MMM yyyy`, accepts typed `dd/mm/yyyy` parsed in
 * IST, Monday-first weeks. Keyboard: Alt+Down (or the calendar button) opens the calendar, arrows
 * move by day, Enter picks, Esc closes and returns focus; Enter in the input commits typed text.
 */
export function DatePicker({
  value: valueProp,
  defaultValue = null,
  onChange,
  holidays,
  getHolidayName,
  disabledDays,
  weekStartsOn = 1,
  timeZone = IST_TIME_ZONE,
  labels,
  className,
  onBlur,
  onKeyDown,
  placeholder,
  ...props
}: DatePickerProps) {
  const text = { ...DEFAULT_DATE_PICKER_LABELS, ...labels };
  const control = useFieldControl(props);
  const [local, setLocal] = useState<Date | null>(defaultValue);
  const value = valueProp === undefined ? local : valueProp;
  const show = (date: Date | null) => (date ? formatDisplayDate(date, timeZone) : '');
  const [draft, setDraft] = useState(() => show(value));
  const [typedInvalid, setTypedInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const errorId = useId();

  // Re-show the value when it changes from outside (a new Date for the same day keeps typing).
  const valueKey = value ? value.getTime() : null;
  const syncKey = `${String(valueKey)}|${timeZone}`;
  const [syncedKey, setSyncedKey] = useState(syncKey);
  if (syncedKey !== syncKey) {
    setSyncedKey(syncKey);
    setDraft(show(value));
    setTypedInvalid(false);
  }

  const commit = (picked: Date | null) => {
    const date = picked ? new Date(picked.getTime()) : null;
    setTypedInvalid(false);
    setDraft(show(date));
    if (valueProp === undefined) setLocal(date);
    if ((date?.getTime() ?? null) !== valueKey) onChange?.(date);
  };

  const commitDraft = () => {
    if (!draft.trim()) {
      commit(null);
      return;
    }
    const parsed = parseDateInput(draft, timeZone);
    if (parsed) commit(parsed);
    else setTypedInvalid(true);
  };

  const interactive = !control.disabled && !control.readOnly;
  const invalid = typedInvalid || control.invalid;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && !interactive) return;
        setOpen(next);
      }}
    >
      <div data-slot="date-picker" className={cn('grid w-full gap-1.5', className)}>
        <PopoverAnchor asChild>
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              autoComplete="off"
              {...props}
              placeholder={placeholder ?? text.placeholder}
              value={draft}
              aria-invalid={invalid || undefined}
              aria-describedby={
                cn(props['aria-describedby'], typedInvalid ? errorId : undefined) || undefined
              }
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setDraft(event.target.value);
                if (typedInvalid) setTypedInvalid(false);
              }}
              onBlur={(event: FocusEvent<HTMLInputElement>) => {
                commitDraft();
                onBlur?.(event);
              }}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                onKeyDown?.(event);
                if (event.defaultPrevented) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitDraft();
                } else if (event.key === 'ArrowDown' && event.altKey && interactive) {
                  event.preventDefault();
                  returnFocus.current = event.currentTarget;
                  setOpen(true);
                }
              }}
            />
            <PopoverTrigger asChild>
              <IconButton
                label={text.openCalendar}
                variant="outline"
                disabled={!interactive}
                aria-expanded={open}
                onClick={(event) => {
                  returnFocus.current = event.currentTarget;
                }}
              >
                <CalendarDays />
              </IconButton>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        {typedInvalid ? (
          <p data-slot="date-picker-error" id={errorId} className="text-danger text-xs">
            {text.invalid}
          </p>
        ) : null}
      </div>
      <PopoverContent
        align="end"
        aria-label={text.calendar}
        className="w-auto p-0"
        onOpenAutoFocus={(event) => {
          // The calendar focuses the selected day (or today) itself.
          event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (returnFocus.current ?? inputRef.current)?.focus();
        }}
      >
        <Calendar
          mode="single"
          autoFocus
          selected={value ?? undefined}
          {...(value ? { defaultMonth: value } : {})}
          onSelect={(date) => {
            commit(date ?? null);
            returnFocus.current = inputRef.current;
            setOpen(false);
          }}
          holidays={holidays}
          getHolidayName={getHolidayName}
          disabled={disabledDays}
          weekStartsOn={weekStartsOn}
          timeZone={timeZone}
          labels={text}
        />
      </PopoverContent>
    </Popover>
  );
}
