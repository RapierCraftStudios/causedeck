// The deadline rule engine (#494, D-048): a period (days, weeks or months) counted from an anchor
// date, rolled to the next working day when the court is closed on the last day. It returns the
// rule it applied as a sentence a lawyer can read ("4 weeks from 22 Oct; court closed 19 Nov, so
// 20 Nov"). The period arithmetic is in period.ts; only the closure roll is
// added here. Pure: the calendar is a value.
import { closedReason, type CourtCalendar } from './calendar.ts';
import { addPeriod, type PeriodUnit } from './period.ts';

export interface DueDateInput {
  /** The date the period runs from (ISO), e.g. the order date. */
  from: string;
  n: number;
  unit: PeriodUnit;
  calendar: CourtCalendar;
}

export interface DueDate {
  /** The first working day on or after the raw end of the period (ISO). */
  date: string;
  /** The end of the period before any closure roll (ISO). */
  rawDate: string;
  rule: string;
}

/** Longest run of closed days the roll will cross before giving up (a calendar with no open day). */
const MAX_ROLL_DAYS = 120;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-19` as `19 Nov` (the year is added when it differs from `yearOf`). */
function short(date: string, yearOf?: string): string {
  const [y = '', m = '1', d = '1'] = date.split('-');
  const label = `${String(Number(d))} ${MONTHS[Number(m) - 1] ?? ''}`;
  return yearOf !== undefined && yearOf.slice(0, 4) !== y ? `${label} ${y}` : label;
}

const nextDay = (date: string): string => addPeriod(date, 1, 'day');

export function computeDueDate(input: DueDateInput): DueDate {
  const { from, n, unit, calendar } = input;
  const rawDate = addPeriod(from, n, unit);
  const period = `${String(n)} ${unit}${n === 1 ? '' : 's'} from ${short(from)}`;
  if (closedReason(calendar, rawDate) === null) return { date: rawDate, rawDate, rule: period };

  let date = rawDate;
  let steps = 0;
  while (closedReason(calendar, date) !== null && steps < MAX_ROLL_DAYS) {
    date = nextDay(date);
    steps += 1;
  }
  const lastClosed = addPeriod(date, -1, 'day');
  const closed =
    lastClosed === rawDate
      ? short(rawDate, from)
      : `${short(rawDate, from)} to ${short(lastClosed, from)}`;
  return {
    date,
    rawDate,
    rule: `${period}; court closed ${closed}, so ${short(date, from)}`,
  };
}
