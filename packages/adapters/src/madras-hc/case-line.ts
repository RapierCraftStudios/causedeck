// Madras HC case-line grammar (#395, part 1 of #36). One list or order line can name several cases:
//
//   W.P.No.12345 of 2026 | WP No. 12345/2026 | W.P.(MD)No.678 of 2026        -> one reference
//   CRL OP No.4567 of 2026 and Crl.M.P.Nos.1 & 2 of 2026                     -> main + 2 children
//   W.M.P.Nos.13001 to 13003 of 2026                                         -> 3 references
//   O.A.Nos.1 and 2 of 2026 in C.S.No.9 of 2026                               -> main + 2 children
//
// A group is a case type, `No.`/`Nos.`, numbers joined by `,`, `&`, `and` or `to` (an inclusive
// range), then `of YEAR` or `/YEAR`. `X in Y` files X within Y; a miscellaneous type (WMP, CRL MP,
// ...) after a main case it belongs to is filed within it. Children carry the parent's match key as
// `parentProceedingKey`. A `(MD)` reference on a Principal Seat line is kept and flagged
// `forumMismatch`; an unknown type is kept as printed with a `case_type_unknown` diagnostic. Pure and
// total: it never throws.
import { expandYear } from '../normalise/case-number.ts';
import { compactCaseType, parseCaseType } from '../normalise/case-type.ts';
import { matchKey } from '../normalise/match-key.ts';
import type { CaseRef } from '../types.ts';

import { caseTypeInfo, MADRAS_HC_CASE_TYPE_ALIASES } from './config/case-types.ts';

export type CaseLineDiagnosticCode = 'case_type_unknown' | 'range_too_large';

export interface CaseLineDiagnostic {
  code: CaseLineDiagnosticCode;
  raw: string;
}

export interface CaseLine {
  /** Top-level references; children hang off their main case. */
  refs: CaseRef[];
  diagnostics: CaseLineDiagnostic[];
  /** A reference names a seat other than `forumSeat`. */
  forumMismatch: boolean;
}

export interface CaseLineOptions {
  /** The seat suffix of the forum the line was read for; null (default) is the Principal Seat. */
  forumSeat?: string | null;
  /** Two-digit-year pivot (default 50). */
  pivot?: number;
  /** `nomenclature.caseTypes`; defaults to the Madras HC table. */
  aliases?: Readonly<Record<string, readonly string[]>>;
  seatSuffixes?: readonly string[];
}

/** Longest range expanded item by item; a longer one keeps its two ends. */
export const MAX_RANGE_ITEMS = 100;
const MAX_LINE_LENGTH = 2000;

const GROUP =
  /(?:\b(and|in|with)\s+)?([A-Za-z(][A-Za-z.()\s]*?)\s*(?:\bNos?\b\.?\s*)?(\d{1,7}(?:\s*(?:,|&|\band\b|\bto\b)\s*\d{1,7})*)\s*(?:\bof\b|\/)\s*(\d{4}|\d{2})\b/gi;

interface Group {
  connector: string | null;
  refs: CaseRef[];
  misc: boolean;
}

function numbersOf(list: string, diagnostics: CaseLineDiagnostic[]): string[] {
  const numbers: string[] = [];
  for (const part of list.split(/\s*(?:,|&|\band\b)\s*/i)) {
    const range = /^(\d+)\s*to\s*(\d+)$/i.exec(part.trim());
    if (range === null) {
      if (/^\d+$/.test(part.trim())) numbers.push(part.trim());
      continue;
    }
    const from = Number.parseInt(range[1] ?? '', 10);
    const to = Number.parseInt(range[2] ?? '', 10);
    if (to >= from && to - from < MAX_RANGE_ITEMS) {
      for (let n = from; n <= to; n += 1) numbers.push(String(n));
    } else {
      diagnostics.push({ code: 'range_too_large', raw: part.trim() });
      numbers.push(String(from), String(to));
    }
  }
  return numbers.map((n) => n.replace(/^0+(?=\d)/, ''));
}

function withParent(child: CaseRef, parent: CaseRef): CaseRef {
  return { ...child, parentProceedingKey: parent.matchKey };
}

function adopt(parent: CaseRef, children: CaseRef[]): void {
  parent.children = [...(parent.children ?? []), ...children.map((c) => withParent(c, parent))];
}

/** The case references on one line; see the file comment for the grammar. */
export function parseCaseLine(line: string, options: CaseLineOptions = {}): CaseLine {
  const diagnostics: CaseLineDiagnostic[] = [];
  const typeOptions = {
    aliases: options.aliases ?? MADRAS_HC_CASE_TYPE_ALIASES,
    seatSuffixes: options.seatSuffixes ?? ['MD'],
  };
  const groups: Group[] = [];
  for (const match of line.slice(0, MAX_LINE_LENGTH).matchAll(GROUP)) {
    const caseTypeRaw = (match[2] ?? '').trim();
    const year = expandYear(match[4] ?? '', { pivot: options.pivot ?? 50 });
    if (year === null) continue;
    const parsed = parseCaseType(caseTypeRaw, typeOptions);
    const compact = compactCaseType(caseTypeRaw);
    const caseTypeCode = parsed?.caseType ?? (compact === '' ? null : compact);
    const info = caseTypeCode === null ? undefined : caseTypeInfo(caseTypeCode);
    if (info === undefined && !diagnostics.some((d) => d.raw === caseTypeRaw)) {
      diagnostics.push({ code: 'case_type_unknown', raw: caseTypeRaw });
    }
    const seatSuffix = parsed?.seatSuffix;
    const refs = numbersOf(match[3] ?? '', diagnostics).map((number): CaseRef => ({
      caseTypeCode,
      caseTypeRaw,
      number,
      year,
      ...(seatSuffix === undefined ? {} : { seatSuffix }),
      ...(info?.isMisc === true ? { isMisc: true } : {}),
      matchKey: matchKey({
        caseType: caseTypeCode,
        seatSuffix,
        caseNumber: number,
        caseYear: year,
      }),
    }));
    groups.push({
      connector: match[1]?.toLowerCase() ?? null,
      refs,
      misc: info?.isMisc === true,
    });
  }

  const top: CaseRef[] = [];
  let previous: CaseRef[] = [];
  for (const group of groups) {
    const [main] = group.refs;
    if (group.connector === 'in' && main !== undefined && previous.length > 0) {
      // `X in Y`: the previous group is filed within this one.
      const filed = new Set(previous);
      top.splice(0, top.length, ...top.filter((ref) => !filed.has(ref)));
      adopt(main, previous);
      top.push(...group.refs);
      previous = group.refs;
      continue;
    }
    if (group.misc && main !== undefined) {
      const parents = caseTypeInfo(main.caseTypeCode ?? '')?.parentCodes ?? [];
      const parent = [...top]
        .reverse()
        .find((ref) => ref.isMisc !== true && parents.includes(ref.caseTypeCode ?? ''));
      if (parent !== undefined) {
        adopt(parent, group.refs);
        previous = group.refs;
        continue;
      }
    }
    top.push(...group.refs);
    previous = group.refs;
  }

  const forumSeat = options.forumSeat ?? null;
  const all = top.flatMap((ref) => [ref, ...(ref.children ?? [])]);
  const forumMismatch = all.some((ref) => (ref.seatSuffix ?? null) !== forumSeat);
  return { refs: top, diagnostics, forumMismatch };
}
