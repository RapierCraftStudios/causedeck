// Deterministic claim extraction: regexes and the consistency/citation matchers, no model and no
// I/O. Tamil and Kannada digits are mapped to ASCII one character for one, so spans stay valid in
// the text as written.
import { extractFromText } from '../citations/extract';
import { canonicalCaseType, findCaseNumbers } from '../consistency/match-case-numbers';
import { findDates } from '../consistency/match-dates';
import { findNameMentions } from '../consistency/match-names';

import type { Claim, ClaimPort, ClaimKind, CourtRefKind, PortClaim } from './types';

const ZERO_TAMIL = 0x0be6;
const ZERO_KANNADA = 0x0ce6;

/** Same length as the input: each Tamil or Kannada digit becomes its ASCII digit. */
export function normalizeDigits(text: string): string {
  return text.replace(/[௦-௯೦-೯]/g, (c) => {
    const code = c.charCodeAt(0);
    return String(code >= ZERO_KANNADA ? code - ZERO_KANNADA : code - ZERO_TAMIL);
  });
}

const CNR = /(?<![A-Za-z0-9])([A-Z]{4}\d{2})-?(\d{6})-?(\d{4})(?![A-Za-z0-9])/g;
const AMOUNT =
  /(?:Rs\.?|INR|₹)[ \t]*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?:[ \t]*(lakhs?|crores?))?/gi;
const COURT_REF =
  /\b(Court[ \t]+Hall|Court|Hall|Item)[ \t]+(?:No\.?|Number)?[ \t]*(\d{1,3})(?!\d)(?![ \t]*(?:\/|of[ \t]+\d{4}))/gi;
const MD_BENCH = /\(\s*MD\s*\)/i;

/** Paise as a digit string, so `Rs. 1.5 lakh` and `Rs.1,50,000` agree. */
export function toPaise(digits: string, unit: string | undefined): string {
  const [whole = '0', frac = ''] = digits.replace(/,/g, '').split('.');
  const scale = unit === undefined ? 1 : /^lakh/i.test(unit) ? 100_000 : 10_000_000;
  const paise = (Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2))) * scale;
  return String(paise);
}

/** Canonical case value; the bench tag `(MD)` stays part of it because the series differ. */
export function caseValue(caseType: string, number: string, year: number, raw = caseType): string {
  const code = canonicalCaseType(caseType) ?? caseType.replace(/[^A-Za-z]/g, '').toUpperCase();
  const bench = MD_BENCH.test(raw) ? '(MD)' : '';
  return `${code}${bench}/${number.replace(/^0+(?=\d)/, '')}/${String(year)}`;
}

const refKind = (word: string): CourtRefKind => {
  const w = word.toLowerCase();
  return w === 'item' ? 'item' : w === 'court hall' || w === 'hall' ? 'hall' : 'court';
};

type Draft = Omit<Claim, 'id' | 'blockKey' | 'origin'>;

function ruleClaims(norm: string): Draft[] {
  const out: Draft[] = [];
  for (const d of findDates(norm)) {
    out.push({
      kind: 'date',
      start: d.start,
      end: d.end,
      raw: d.raw,
      value: d.iso,
      context: d.context,
    });
  }
  for (const c of findCaseNumbers(norm)) {
    const raw = norm.slice(c.start, c.end);
    out.push({
      kind: 'case_number',
      start: c.start,
      end: c.end,
      raw: c.raw,
      value: caseValue(c.caseType, c.number, c.year, raw),
    });
  }
  for (const n of findNameMentions(norm)) {
    out.push({
      kind: 'party_role',
      start: n.start,
      end: n.end,
      raw: n.raw,
      value: n.raw,
      role: n.role,
    });
  }
  for (const m of norm.matchAll(AMOUNT)) {
    out.push({
      kind: 'amount',
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
      value: toPaise(m[1] ?? '0', m[2]),
    });
  }
  for (const m of norm.matchAll(CNR)) {
    out.push({
      kind: 'cnr',
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
      value: `${m[1] ?? ''}${m[2] ?? ''}${m[3] ?? ''}`,
    });
  }
  for (const m of norm.matchAll(COURT_REF)) {
    out.push({
      kind: 'court_ref',
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
      value: String(Number(m[2])),
      ref: refKind(m[1] ?? ''),
    });
  }
  for (const c of extractFromText(norm, 'x')) {
    if (c.kind !== 'neutral' && c.kind !== 'reporter') continue;
    out.push({
      kind: 'citation',
      start: c.span[0],
      end: c.span[1],
      raw: c.raw,
      value: c.normalized,
      citation: { kind: c.kind, ...(c.titleHint === undefined ? {} : { titleHint: c.titleHint }) },
    });
  }
  return out;
}

const finish = (blockKey: string, text: string, d: Draft, origin: Claim['origin']): Claim => ({
  ...d,
  raw: text.slice(d.start, d.end),
  id: `${blockKey}:${String(d.start)}-${String(d.end)}`,
  blockKey,
  origin,
});

/** Claims in one block's text, ordered by position. */
export function extractClaims(text: string, blockKey = 'b'): Claim[] {
  return ruleClaims(normalizeDigits(text))
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((d) => finish(blockKey, text, d, 'rule'));
}

const KINDS: readonly ClaimKind[] = [
  'date',
  'case_number',
  'party_role',
  'amount',
  'citation',
  'cnr',
  'court_ref',
];

/**
 * Rule claims plus what the optional port adds. A port claim is kept only when its span lies in the
 * text and does not overlap a rule claim of the same kind; the port never overrides a rule.
 */
export async function extractWithPort(
  text: string,
  blockKey: string,
  port: ClaimPort | undefined,
  { indiaOnly = true }: { indiaOnly?: boolean } = {},
): Promise<Claim[]> {
  const claims = extractClaims(text, blockKey);
  if (port === undefined) return claims;
  const found: readonly PortClaim[] = await port.findClaims({ text, indiaOnly });
  for (const p of found) {
    const valid =
      KINDS.includes(p.kind) &&
      Number.isInteger(p.start) &&
      p.start >= 0 &&
      p.end > p.start &&
      p.end <= text.length &&
      p.value.trim() !== '';
    if (!valid) continue;
    if (claims.some((c) => c.kind === p.kind && c.start < p.end && p.start < c.end)) continue;
    claims.push(
      finish(
        blockKey,
        text,
        { kind: p.kind, start: p.start, end: p.end, raw: '', value: p.value },
        'port',
      ),
    );
  }
  return claims.sort((a, b) => a.start - b.start || a.end - b.end);
}

export interface BlockText {
  key: string;
  text: string;
}

/** Re-extracts only the blocks whose text changed since the last call. */
export function createClaimIndex(): { update(blocks: readonly BlockText[]): Claim[] } {
  let cache = new Map<string, { text: string; claims: Claim[] }>();
  return {
    update(blocks) {
      const next = new Map<string, { text: string; claims: Claim[] }>();
      const out: Claim[] = [];
      for (const b of blocks) {
        const hit = cache.get(b.key);
        const entry =
          hit?.text === b.text ? hit : { text: b.text, claims: extractClaims(b.text, b.key) };
        next.set(b.key, entry);
        out.push(...entry.claims);
      }
      cache = next;
      return out;
    },
  };
}
