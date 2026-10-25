// The usage page's view model (#223, #30 part 6): one meter per capped resource (AI processing spend
// against the monthly AI budget, OCR pages, transcription minutes, active matters) with percent
// used, level and reset date, plus a breakdown of every metered key this month. Pure, so the states
// are unit-testable without a database; the page loads the counters and limits (`@causedeck/core`)
// and the components only translate and lay out.
//
// Levels follow the AI budget thresholds (`usageLevel` in packages/core/src/usage/thresholds.ts):
// `warning` from the soft limit (80%), `exceeded` at 100%. The core barrel reaches the database, so
// the page passes the soft limit and the reset instant (`nextPeriodStart`) in rather than this
// module importing it.
import type { UsageKey } from '@causedeck/core/usage';
import {
  formatIndianGrouping,
  formatInr,
  formatNumber,
  IST_TIME_ZONE,
  LOCALE_BCP47,
  type Locale,
} from '@causedeck/i18n';

/** Basis points: 10 000 is 100% of a limit. */
const FULL_BPS = 10_000;
const DEFAULT_SOFT_LIMIT_BPS = 8_000;

export interface UsageLimitsInput {
  /** Effective monthly AI budget in paise (override or entitlement); null is unlimited. */
  aiBudgetPaise: number | null;
  /** Monthly fair-use caps and the active matters cap from the entitlements; null is unlimited. */
  ocrPages: number | null;
  captureMinutes: number | null;
  maxActiveMatters: number | null;
}

export interface UsageViewInput {
  /** This IST month's counter per key; a missing key is 0. */
  counters: Readonly<Partial<Record<UsageKey, number>>>;
  limits: UsageLimitsInput;
  /** When the monthly meters reset: 00:00 IST on the 1st of next month (`nextPeriodStart`). */
  resetAt: Date;
  locale: Locale;
  /** The soft limit in basis points (`SOFT_LIMIT_BPS`); defaults to 80%. */
  softLimitBps?: number;
}

export type UsageLevel = 'ok' | 'warning' | 'exceeded';

export type MeterId = 'ai' | 'ocr' | 'stt' | 'matters';

export interface MeterView {
  id: MeterId;
  /** Formatted amount used, e.g. `₹112.00` or `42`. */
  used: string;
  /** Formatted limit; null when the plan has no limit (no bar, no percent). */
  limit: string | null;
  /** Whole percent used (may exceed 100); null when unlimited. */
  percent: number | null;
  level: UsageLevel;
  /** `1 Apr` in the locale, IST; null for active matters, a level rather than a monthly total. */
  resetDate: string | null;
}

export type BreakdownId =
  'aiSpend' | 'tokensIn' | 'tokensOut' | 'ocr' | 'stt' | 'storage' | 'matters';

export interface BreakdownRow {
  id: BreakdownId;
  used: string;
  /** Null when the resource has no limit. */
  limit: string | null;
}

export interface UsageView {
  /** Nothing metered yet this month. */
  empty: boolean;
  meters: MeterView[];
  breakdown: BreakdownRow[];
}

const SECONDS_PER_MINUTE = 60;

/** Counters are never shown below zero (gauges take signed deltas within a period). */
function count(counters: UsageViewInput['counters'], key: UsageKey): number {
  return Math.max(0, counters[key] ?? 0);
}

/** `1 Apr`: day and short month in IST. */
export function formatResetDate(at: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_BCP47[locale], {
    timeZone: IST_TIME_ZONE,
    day: 'numeric',
    month: 'short',
  }).format(at);
}

/** Bytes in the largest unit that keeps the value at or above 1, one decimal at most. */
export function formatBytes(bytes: number, locale: Locale): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
  let value = Math.max(0, bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return formatNumber(value, {
    locale,
    style: 'unit',
    unit: units[index],
    unitDisplay: 'short',
    maximumFractionDigits: index === 0 ? 0 : 1,
  });
}

function formatMinutes(minutes: number, locale: Locale): string {
  return formatNumber(minutes, { locale, style: 'unit', unit: 'minute', unitDisplay: 'short' });
}

const formatCount = (value: number): string => formatIndianGrouping(String(Math.floor(value)));

/** Where `used` stands against `limit`: the same rule as the AI budget thresholds. */
export function levelOf(used: number, limit: number | null, softLimitBps: number): UsageLevel {
  if (limit === null) return 'ok';
  if (used >= limit) return 'exceeded';
  if (used * FULL_BPS >= limit * softLimitBps) return 'warning';
  return 'ok';
}

/** Whole percent used, floored; a zero limit counts as fully used. */
export function percentOf(used: number, limit: number): number {
  if (limit <= 0) return 100;
  return Math.floor((used * 100) / limit);
}

export function toUsageView(input: UsageViewInput): UsageView {
  const { counters, limits, locale } = input;
  const soft = input.softLimitBps ?? DEFAULT_SOFT_LIMIT_BPS;
  const resetDate = formatResetDate(input.resetAt, locale);

  const spent = count(counters, 'ai.spend_paise');
  const pages = count(counters, 'ocr.pages');
  const seconds = count(counters, 'stt.seconds');
  const matters = count(counters, 'matters.active');
  const sttLimitSeconds =
    limits.captureMinutes === null ? null : limits.captureMinutes * SECONDS_PER_MINUTE;

  const meter = (
    id: MeterId,
    used: number,
    limit: number | null,
    format: (value: number) => string,
    display: { used: number; limit: number | null } = { used, limit },
    monthly = true,
  ): MeterView => ({
    id,
    used: format(display.used),
    limit: display.limit === null ? null : format(display.limit),
    percent: limit === null ? null : percentOf(used, limit),
    level: levelOf(used, limit, soft),
    resetDate: monthly ? resetDate : null,
  });

  const minutes = (value: number) => formatMinutes(value, locale);
  const meters = [
    meter('ai', spent, limits.aiBudgetPaise, (paise) => formatInr(paise, { locale })),
    meter('ocr', pages, limits.ocrPages, formatCount),
    meter('stt', seconds, sttLimitSeconds, minutes, {
      used: Math.floor(seconds / SECONDS_PER_MINUTE),
      limit: limits.captureMinutes,
    }),
    meter('matters', matters, limits.maxActiveMatters, formatCount, undefined, false),
  ];

  const breakdown: BreakdownRow[] = [
    {
      id: 'aiSpend',
      used: formatInr(spent, { locale }),
      limit: limits.aiBudgetPaise === null ? null : formatInr(limits.aiBudgetPaise, { locale }),
    },
    { id: 'tokensIn', used: formatCount(count(counters, 'ai.tokens_in')), limit: null },
    { id: 'tokensOut', used: formatCount(count(counters, 'ai.tokens_out')), limit: null },
    {
      id: 'ocr',
      used: formatCount(pages),
      limit: limits.ocrPages === null ? null : formatCount(limits.ocrPages),
    },
    {
      id: 'stt',
      used: minutes(Math.floor(seconds / SECONDS_PER_MINUTE)),
      limit: limits.captureMinutes === null ? null : minutes(limits.captureMinutes),
    },
    { id: 'storage', used: formatBytes(count(counters, 'storage.bytes'), locale), limit: null },
    {
      id: 'matters',
      used: formatCount(matters),
      limit: limits.maxActiveMatters === null ? null : formatCount(limits.maxActiveMatters),
    },
  ];

  const empty = Object.values(counters).every((value) => value <= 0);
  return { empty, meters, breakdown };
}
