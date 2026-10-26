// Case-number matching: `W.P.No.1234 of 2025`, `WP 1234/2025`, `W.P.(MD) No. 1234 of 2025`, `Writ
// Petition No. 1234 of 2025`, `Crl.O.P.No.55/2025` and the like are read as (type, number, year) and
// compared with the proceedings of the matter. A mention is only checked against a proceeding it
// resembles (same type, or the same number and year), so an unrelated case number is left alone.
import type { FindingProvenance } from '@causedeck/validators/consistency';

import type { Located } from './extract-entities';
import type { Hit } from './match-names';

export interface ProceedingFact {
  /** Normalised type code as stored (`WP`). */
  caseTypeCode: string;
  /** The type as printed (`W.P.`), used when proposing a replacement. */
  caseTypeRaw: string | null;
  number: string;
  year: number;
  provenance: FindingProvenance;
}

export interface CaseNumberHit {
  start: number;
  end: number;
  raw: string;
  /** Canonical type code, e.g. `WP`. */
  caseType: string;
  number: string;
  year: number;
}

/** Long forms and lettering variants that mean a catalogue code. Keys are letters only, upper case. */
const ALIASES: Record<string, string> = {
  WRITPETITION: 'WP',
  WRITPETITIONCIVIL: 'WP',
  WRITPETITIONCRIMINAL: 'WPCRL',
  WPC: 'WP',
  WRITAPPEAL: 'WA',
  CRIMINALORIGINALPETITION: 'CRLOP',
  CRIMINALPETITION: 'CRLP',
  CRIMINALAPPEAL: 'CRLA',
  CRIMINALREVISIONPETITION: 'CRLRP',
  CIVILMISCELLANEOUSPETITION: 'CMP',
  CIVILMISCELLANEOUSAPPEAL: 'CMA',
  CIVILREVISIONPETITION: 'CRP',
  CIVILSUITAPPEAL: 'CSA',
  REGULARFIRSTAPPEAL: 'RFA',
  REGULARSECONDAPPEAL: 'RSA',
  MISCELLANEOUSFIRSTAPPEAL: 'MFA',
  MISCELLANEOUSSECONDAPPEAL: 'MSA',
  LETTERSPATENTAPPEAL: 'LPA',
  SPECIALLEAVEPETITION: 'SLP',
  SECONDAPPEAL: 'SA',
  FIRSTAPPEAL: 'FA',
  ORIGINALPETITION: 'OP',
  CONTEMPTPETITION: 'CONTP',
  REVIEWPETITION: 'RP',
  TAXCASEREVISION: 'TCR',
  TAXCASEREVISIONPETITION: 'TCRP',
  ARBITRATIONPETITION: 'ARBP',
  HABEASCORPUSPETITION: 'HCP',
  CRIMINALMISCELLANEOUSPETITION: 'CRLMP',
  CRL: 'CRL',
};
const KNOWN_CODES = new Set([
  'WP',
  'WA',
  'WPCRL',
  'WPMP',
  'WMP',
  'CRLOP',
  'CRLP',
  'CRLA',
  'CRLRP',
  'CRLMP',
  'CMP',
  'CMA',
  'CRP',
  'CSA',
  'RFA',
  'RSA',
  'MFA',
  'MSA',
  'LPA',
  'SLP',
  'SA',
  'FA',
  'OP',
  'CONTP',
  'RP',
  'TCR',
  'TCRP',
  'ARBP',
  'HCP',
  'CC',
  'OS',
  'AS',
  'CA',
  'TRP',
  'IA',
  'MA',
  'SCA',
  'OSA',
  'TA',
  'CP',
  'CRLMC',
  'CRLRC',
  'MCA',
  'MCC',
  'SC',
  'EP',
  'XOB',
]);

/** Letters only, upper case, brackets and what is inside them dropped (`W.P.(MD)` is `WP`). */
const lettersOf = (s: string): string =>
  s
    .replace(/\([^)]*\)/g, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();

/** The canonical code for a case type as written or stored, or undefined when it is not a known type. */
export function canonicalCaseType(raw: string): string | undefined {
  const letters = lettersOf(raw);
  for (const tail of ['', 'NOS', 'NO']) {
    if (tail !== '' && !letters.endsWith(tail)) continue;
    const base = tail === '' ? letters : letters.slice(0, -tail.length);
    const code = ALIASES[base] ?? base;
    if (KNOWN_CODES.has(code) || ALIASES[base] !== undefined) return code;
  }
  return undefined;
}

const NUMBER_YEAR = /(?<![\d/])(\d{1,7})[ \t]*(?:\/|\b[Oo][Ff]\b)[ \t]*((?:19|20)\d{2})(?!\d)/g;
const TYPE_TOKEN = /\([^)\n]{1,12}\)|[A-Za-z]+\.?/g;
const LOOKBEHIND = 60;

export function findCaseNumbers(text: string): CaseNumberHit[] {
  const out: CaseNumberHit[] = [];
  for (const m of text.matchAll(NUMBER_YEAR)) {
    const numberAt = m.index;
    const from = Math.max(0, numberAt - LOOKBEHIND);
    const before = text.slice(from, numberAt);
    // Tokens that run up to the number with only blanks between them, taken from the right.
    const tokens: { at: number; end: number; raw: string }[] = [];
    for (const t of before.matchAll(TYPE_TOKEN)) {
      tokens.push({ at: from + t.index, end: from + t.index + t[0].length, raw: t[0] });
    }
    const chain: typeof tokens = [];
    let edge = numberAt;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (t === undefined || !/^[ \t]*$/.test(text.slice(t.end, edge))) break;
      chain.unshift(t);
      edge = t.at;
    }
    for (let i = 0; i < chain.length; i++) {
      const first = chain[i];
      if (first === undefined) continue;
      const typeText = text.slice(first.at, numberAt);
      const caseType = canonicalCaseType(typeText);
      if (caseType === undefined) continue;
      const end = numberAt + m[0].length;
      out.push({
        start: first.at,
        end,
        raw: text.slice(first.at, end),
        caseType,
        number: (m[1] ?? '').replace(/^0+(?=\d)/, ''),
        year: Number(m[2]),
      });
      break;
    }
  }
  return out;
}

export function formatCaseNumber(p: ProceedingFact): string {
  const type = p.caseTypeRaw?.trim() || p.caseTypeCode;
  return `${type} No.${p.number} of ${String(p.year)}`;
}

const sameNumber = (a: string, b: string): boolean =>
  a.replace(/^0+(?=\d)/, '') === b.replace(/^0+(?=\d)/, '');

export function checkCaseNumbers(
  mentions: readonly (Located & Omit<CaseNumberHit, 'start' | 'end' | 'raw'>)[],
  proceedings: readonly ProceedingFact[],
): Hit[] {
  const hits: Hit[] = [];
  const facts = proceedings.map((p) => ({
    p,
    type: canonicalCaseType(p.caseTypeCode) ?? p.caseTypeCode.toUpperCase(),
  }));
  for (const m of mentions) {
    const sameType = facts.filter((f) => f.type === m.caseType);
    if (sameType.some((f) => sameNumber(f.p.number, m.number) && f.p.year === m.year)) continue;
    const sameNumberYear = facts.filter(
      (f) => sameNumber(f.p.number, m.number) && f.p.year === m.year,
    );
    const close = sameType.find(
      (f) => sameNumber(f.p.number, m.number) || f.p.year === m.year,
    );
    const target = close ?? sameNumberYear[0] ?? sameType[0];
    if (target === undefined) continue;
    const expected = formatCaseNumber(target.p);
    hits.push({
      rule: 'case_number.mismatch',
      severity: close !== undefined || sameNumberYear.length > 0 ? 'error' : 'warn',
      blockKey: m.blockKey,
      start: m.start,
      end: m.end,
      expected,
      found: m.raw,
      provenance: target.p.provenance,
      fix: { replacement: expected },
    });
  }
  return hits;
}
