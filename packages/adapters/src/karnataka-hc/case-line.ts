// Karnataka HC case-line grammar (#404, part 1 of #37). Shapes seen in orders (research/raw/09 §6):
//
//   WP No. 12345/2026 | W.P. No. 12345 of 2026 (GM-RES) | CRL.P No. 100137 of 2025
//   IA No. 1/2026 in WP No. 12345/2026                                  -> main + 1 child
//
// A reference is a case type, an optional `No.`, one number, then `of YEAR` or `/YEAR`, optionally
// followed by a bracketed writ category (`(GM-RES)`), kept as `subCategory`. Numbers are opaque
// strings, kept as printed: nothing assumes a uniform sequence, and a number >= 100000 only sets
// the hint `benchNumbering: '100xxx'`. `X in Y` files X within Y (children carry Y's match key as
// `parentProceedingKey`). An unknown type is kept as printed with a `case_type_unknown` diagnostic.
// Pure and total: it never throws.
import { expandYear } from '../normalise/case-number.ts';
import { compactCaseType, parseCaseType } from '../normalise/case-type.ts';
import { matchKey } from '../normalise/match-key.ts';
import type { BenchNumbering, CaseRef } from '../types.ts';

import { KARNATAKA_HC_CASE_TYPE_ALIASES, karnatakaCaseTypeInfo } from './config/case-types.ts';

export interface KarnatakaCaseLineDiagnostic {
  code: 'case_type_unknown';
  raw: string;
}

export interface KarnatakaCaseLine {
  /** Top-level references; children hang off their main case. */
  refs: CaseRef[];
  diagnostics: KarnatakaCaseLineDiagnostic[];
}

export interface KarnatakaCaseLineOptions {
  /** Two-digit-year pivot (default 50). */
  pivot?: number;
  /** `nomenclature.caseTypes`; defaults to the Karnataka HC table. */
  aliases?: Readonly<Record<string, readonly string[]>>;
}

/** Numbers at or above this get the `100xxx` hint. */
export const KARNATAKA_BENCH_NUMBERING_FROM = 100_000;
const MAX_LINE_LENGTH = 2000;

const REFERENCE =
  /(?:\b(in)\s+)?([A-Za-z][A-Za-z.()\s]*?)\s*(?:\bNos?\b\.?\s*)?(\d{1,7})\s*(?:\bof\b|\/)\s*(\d{4}|\d{2})\b(?:\s*\(\s*([A-Za-z0-9][A-Za-z0-9 .&/-]*?)\s*\))?/gi;

/** The hint for an opaque case number, or undefined. */
export function karnatakaBenchNumbering(number: string): BenchNumbering | undefined {
  return /^\d+$/.test(number) && Number(number) >= KARNATAKA_BENCH_NUMBERING_FROM
    ? '100xxx'
    : undefined;
}

/** The case references on one line; see the file comment for the grammar. */
export function parseKarnatakaCaseLine(
  line: string,
  options: KarnatakaCaseLineOptions = {},
): KarnatakaCaseLine {
  const diagnostics: KarnatakaCaseLineDiagnostic[] = [];
  const aliases = options.aliases ?? KARNATAKA_HC_CASE_TYPE_ALIASES;
  const top: CaseRef[] = [];
  let previous: CaseRef | null = null;
  for (const match of line.slice(0, MAX_LINE_LENGTH).matchAll(REFERENCE)) {
    const caseTypeRaw = (match[2] ?? '').trim();
    const year = expandYear(match[4] ?? '', { pivot: options.pivot ?? 50 });
    const number = match[3] ?? '';
    if (year === null || number === '') continue;
    const compact = compactCaseType(caseTypeRaw);
    const caseTypeCode =
      parseCaseType(caseTypeRaw, { aliases, seatSuffixes: [] })?.caseType ??
      (compact === '' ? null : compact);
    if (
      (caseTypeCode === null || karnatakaCaseTypeInfo(caseTypeCode) === undefined) &&
      !diagnostics.some((d) => d.raw === caseTypeRaw)
    ) {
      diagnostics.push({ code: 'case_type_unknown', raw: caseTypeRaw });
    }
    const subCategory = match[5]?.trim();
    const benchNumbering = karnatakaBenchNumbering(number);
    const ref: CaseRef = {
      caseTypeCode,
      caseTypeRaw,
      number,
      year,
      ...(caseTypeCode !== null && karnatakaCaseTypeInfo(caseTypeCode)?.isMisc === true
        ? { isMisc: true }
        : {}),
      matchKey: matchKey({ caseType: caseTypeCode, caseNumber: number, caseYear: year }),
      ...(subCategory === undefined || subCategory === '' ? {} : { subCategory }),
      ...(benchNumbering === undefined ? {} : { benchNumbering }),
    };
    if (match[1] !== undefined && previous !== null && top.at(-1) === previous) {
      // `X in Y`: the previous reference is filed within this one.
      top.pop();
      ref.children = [...(ref.children ?? []), { ...previous, parentProceedingKey: ref.matchKey }];
    }
    top.push(ref);
    previous = ref;
  }
  return { refs: top, diagnostics };
}
