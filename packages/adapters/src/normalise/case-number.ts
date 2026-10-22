// Case-number normaliser (#369). Accepts `No. 12345 of 2026`, `12345 of 2026`, `12345/2026` and
// `12345/26`, strips leading zeros and expands a two-digit year with the adapter's pivot (`26` ->
// 2026 with the default pivot 50; above the pivot is 19YY). `parseCaseReference` also splits the
// case type in front of the number (`W.P.(MD) No. 123 of 2026`).
import { parseCaseType, type CaseTypeOptions } from './case-type.ts';

export interface YearOptions {
  /** Two-digit years at or below the pivot are 20YY, above it 19YY. Default 50. */
  pivot?: number;
}

export interface CaseNumber {
  number: string;
  year: number;
}

export interface CaseReference extends CaseNumber {
  caseTypeRaw: string;
  caseType: string | null;
  seatSuffix?: string;
}

export const DEFAULT_YEAR_PIVOT = 50;

const NUMBER_PATTERN = /(?:\bNo\.?\s*)?\b(\d{1,7})\s*(?:\/|\bof\b|-)\s*(\d{4}|\d{2})\b/i;

/** Expand a two-digit year by the pivot; four-digit years pass through. Null outside 1900-2099. */
export function expandYear(
  raw: string,
  { pivot = DEFAULT_YEAR_PIVOT }: YearOptions = {},
): number | null {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) return null;
  const year = raw.length === 2 ? (value <= pivot ? 2000 + value : 1900 + value) : value;
  return year >= 1900 && year <= 2099 ? year : null;
}

/** The case number and year in `raw`, or null when there is none. */
export function normaliseCaseNumber(raw: string, options: YearOptions = {}): CaseNumber | null {
  const match = NUMBER_PATTERN.exec(raw);
  if (match === null) return null;
  const year = expandYear(match[2] ?? '', options);
  if (year === null) return null;
  const number = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  return { number, year };
}

/** A whole reference: case type (with seat suffix), number and year; null without a number. */
export function parseCaseReference(
  raw: string,
  options: YearOptions & CaseTypeOptions = {},
): CaseReference | null {
  const match = NUMBER_PATTERN.exec(raw);
  if (match === null) return null;
  const caseNumber = normaliseCaseNumber(match[0], options);
  if (caseNumber === null) return null;
  const caseTypeRaw = raw.slice(0, match.index).trim();
  const parsed = parseCaseType(caseTypeRaw, options);
  return {
    caseTypeRaw,
    caseType: parsed?.caseType ?? null,
    ...(parsed?.seatSuffix === undefined ? {} : { seatSuffix: parsed.seatSuffix }),
    ...caseNumber,
  };
}
