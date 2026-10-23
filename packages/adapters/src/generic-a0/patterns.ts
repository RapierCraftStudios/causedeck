// A0 patterns (#56): which case types the skeleton recognises and how a case reference is read off
// a line. The set is the union of the nomenclature of every registered adapter and the district
// types below. A district type that no official source confirms is `verified: false`, and so is any
// type outside the set (`known: false`), so a row is never trusted for a spelling we only guessed.
import type { CourtAdapter } from '../types.ts';
import { compactCaseType } from '../normalise/case-type.ts';
import { expandYear } from '../normalise/case-number.ts';
import { listAdapters } from '../registry.ts';

/** The eCourts CNR: 4 letters (state and district), 2 digits (establishment), 6 (case), 4 (year). */
export const CNR_PATTERN = /^[A-Z]{4}\d{2}\d{6}\d{4}$/;
/** The same, found inside a line. */
export const CNR_IN_TEXT = /(?<![A-Za-z0-9])[A-Z]{4}\d{2}\d{6}\d{4}(?![A-Za-z0-9])/g;

export interface DistrictCaseType {
  /** Normal form (`compactCaseType`). */
  code: string;
  /** Printed spellings. */
  spellings: readonly string[];
  /** Confirmed from an official source; false means "read it, but flag it". */
  verified: boolean;
  note?: string;
}

/** District and commercial-court nomenclature (research/raw/09 §2.1, docs/strategy/11 §2.1). */
export const DISTRICT_CASE_TYPES: readonly DistrictCaseType[] = [
  { code: 'OS', spellings: ['O.S.', 'OS'], verified: true },
  { code: 'CRLMISC', spellings: ['Crl.Misc.', 'Crl. Misc.', 'Crl.M.P.'], verified: true },
  { code: 'EXP', spellings: ['Ex.P.', 'E.P.', 'EP'], verified: true },
  { code: 'CCCA', spellings: ['CCCA'], verified: false, note: 'low-reliability spelling' },
  { code: 'COMOS', spellings: ['Com.O.S.', 'Com. O.S.'], verified: true },
  { code: 'COMEX', spellings: ['Com.Ex.', 'Com. Ex.'], verified: true },
  { code: 'COMAP', spellings: ['Com.A.P.', 'Com. A.P.'], verified: true },
  { code: 'COMAA', spellings: ['Com.A.A.', 'Com. A.A.'], verified: true },
  { code: 'COMMISC', spellings: ['Com.Misc.', 'Com. Misc.'], verified: true },
  { code: 'COMFDP', spellings: ['Com.FDP', 'Com. FDP'], verified: true },
  { code: 'CC', spellings: ['C.C.', 'CC'], verified: false },
  { code: 'SC', spellings: ['S.C.', 'SC'], verified: false },
  { code: 'CRLA', spellings: ['Crl.A.', 'Crl.A'], verified: false },
  { code: 'MVC', spellings: ['M.V.C.', 'MVC'], verified: false },
  { code: 'MC', spellings: ['M.C.', 'MC'], verified: false },
  { code: 'FDP', spellings: ['F.D.P.', 'FDP'], verified: false },
];

export interface CaseTypeInfo {
  code: string;
  verified: boolean;
}

/** compact spelling -> info, from the registered adapters (verified) and the district types. */
export type CaseTypeLookup = ReadonlyMap<string, CaseTypeInfo>;

/** The union of every registered adapter's case types and the district types. */
export function buildCaseTypeLookup(
  adapters: readonly Pick<CourtAdapter, 'nomenclature'>[] = listAdapters(),
): CaseTypeLookup {
  const lookup = new Map<string, CaseTypeInfo>();
  for (const type of DISTRICT_CASE_TYPES) {
    for (const spelling of [type.code, ...type.spellings]) {
      lookup.set(compactCaseType(spelling), { code: type.code, verified: type.verified });
    }
  }
  for (const adapter of adapters) {
    for (const [code, spellings] of Object.entries(adapter.nomenclature.caseTypes)) {
      for (const spelling of [code, ...spellings]) {
        const key = compactCaseType(spelling);
        if (key !== '' && !lookup.has(key)) {
          lookup.set(key, { code: compactCaseType(code), verified: true });
        }
      }
    }
  }
  return lookup;
}

export interface CaseRefHit {
  /** The type as printed, e.g. `Com.O.S.`. */
  caseTypeRaw: string;
  /** Normal form of the type, or the compact printed form when it is unknown. */
  caseType: string;
  caseNumber: string;
  caseYear: number;
  /** The type is in the lookup (a registered adapter's or a district type). */
  known: boolean;
  /** The type is confirmed from an official source; false for an unknown type. */
  verified: boolean;
  /** Offsets of the whole reference (type, number and year) in the line. */
  start: number;
  end: number;
}

const NUMBER_YEAR = /(?:\bNos?\.?\s*)?\b(\d{1,7})\s*(?:\/|\bof\b)\s*(\d{4}|\d{2})\b/gi;
const WORD = /^[A-Za-z.&()/-]+$/;

/** Every case reference on a line: a type, a number and a year (`Com.O.S. No. 123/2025`). */
export function findCaseRefs(
  line: string,
  lookup: CaseTypeLookup,
  options: { pivot?: number } = {},
): CaseRefHit[] {
  const hits: CaseRefHit[] = [];
  for (const m of line.matchAll(NUMBER_YEAR)) {
    const year = expandYear(m[2] ?? '', options);
    if (year === null) continue;
    const before = line.slice(0, m.index).replace(/\bNos?\.?\s*$/i, '');
    const trimmed = before.trimEnd();
    const tokens = [...trimmed.matchAll(/\S+/g)];
    let type: { raw: string; compact: string; known: boolean; start: number } | null = null;
    for (let k = Math.min(3, tokens.length); k >= 1; k -= 1) {
      const words = tokens.slice(-k);
      if (!words.every((w) => WORD.test(w[0]))) continue;
      const start = words[0]?.index ?? 0;
      const raw = trimmed.slice(start);
      const compact = compactCaseType(raw);
      if (lookup.has(compact)) {
        type = { raw, compact, known: true, start };
        break;
      }
    }
    if (type === null) {
      const last = tokens[tokens.length - 1];
      const compact = last === undefined ? '' : compactCaseType(last[0]);
      if (last === undefined || !WORD.test(last[0]) || !/^[A-Z]{1,12}$/.test(compact)) continue;
      type = { raw: last[0], compact, known: false, start: last.index };
    }
    const info = lookup.get(type.compact);
    hits.push({
      caseTypeRaw: type.raw,
      caseType: info?.code ?? type.compact,
      caseNumber: (m[1] ?? '').replace(/^0+(?=\d)/, ''),
      caseYear: year,
      known: type.known,
      verified: info?.verified ?? false,
      start: type.start,
      end: m.index + m[0].length,
    });
  }
  return hits;
}
