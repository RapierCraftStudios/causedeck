// Date matching: `12/03/2025`, `12.03.2025`, `12-03-2025`, `1st January 2025`, `the 1st day of Jan, 2025`,
// `first of January 2025`. Indian order (day first). A date that follows "order dated" is compared
// with the order dates of the matter, one that follows "listed on" with its listing dates.
import type { FindingProvenance } from '@causedeck/validators/consistency';

import type { Located } from './extract-entities';
import type { Hit } from './match-names';

export interface DateFact {
  /** ISO calendar date, `2025-03-12`. */
  iso: string;
  provenance: FindingProvenance;
}

export type DateContext = 'order' | 'listing' | null;

export interface DateHit {
  start: number;
  end: number;
  raw: string;
  iso: string;
  context: DateContext;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const monthNo = (w: string): number => {
  const l = w.toLowerCase();
  if (l === 'sept') return 9;
  const at = MONTHS.findIndex((m) => m === l || (l.length === 3 && m.startsWith(l)));
  return at < 0 ? 0 : at + 1;
};

const ORD_UNITS = [
  '',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
];
const ORD_WORDS: Record<string, number> = { twentieth: 20, thirtieth: 30 };
ORD_UNITS.forEach((w, i) => {
  if (w !== '') ORD_WORDS[w] = i;
});
for (const [tens, base] of [
  ['twenty', 20],
  ['thirty', 30],
] as const) {
  for (let u = 1; u <= 9; u++) {
    if (base + u <= 31) ORD_WORDS[`${tens}-${ORD_UNITS[u] ?? ''}`] = base + u;
  }
}

function valid(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2100) return undefined;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return undefined;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const MONTH_RE =
  '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const WORD_ORD = Object.keys(ORD_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const NUMERIC =
  /(?<![\d/.-])(\d{1,2})[ \t]*([/.-])[ \t]*(\d{1,2})[ \t]*\2[ \t]*(\d{4}|\d{2})(?![\d])/g;
const TEXTUAL = new RegExp(
  `(?<![\\p{L}\\d])(?:the[ \\t]+)?(?:(\\d{1,2})(?:st|nd|rd|th)?|(${WORD_ORD}))(?:[ \\t]+day)?(?:[ \\t]+of)?[ \\t]*,?[ \\t]*${MONTH_RE}\\.?[ \\t]*,?[ \\t]*(\\d{4})(?!\\d)`,
  'giu',
);
const CONTEXT_WINDOW = 40;
const ORDER_CUE = /\b(order(?:ed)?|judg(?:e)?ment|decree)\b[^.;]{0,25}$/i;
const LISTING_CUE = /\b(listed|listing|posted|adjourned|next date|hearing|taken up)\b[^.;]{0,25}$/i;

function contextOf(text: string, start: number): DateContext {
  const before = text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  if (ORDER_CUE.test(before)) return 'order';
  if (LISTING_CUE.test(before)) return 'listing';
  return null;
}

export function findDates(text: string): DateHit[] {
  const raw: Omit<DateHit, 'context'>[] = [];
  for (const m of text.matchAll(NUMERIC)) {
    const yy = m[4] ?? '';
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const iso = valid(year, Number(m[3]), Number(m[1]));
    if (iso) raw.push({ start: m.index, end: m.index + m[0].length, raw: m[0], iso });
  }
  for (const m of text.matchAll(TEXTUAL)) {
    const day = m[1] !== undefined ? Number(m[1]) : (ORD_WORDS[(m[2] ?? '').toLowerCase()] ?? 0);
    const iso = valid(Number(m[4]), monthNo(m[3] ?? ''), day);
    if (iso) raw.push({ start: m.index, end: m.index + m[0].length, raw: m[0], iso });
  }
  return raw
    .sort((a, b) => a.start - b.start)
    .map((h) => ({ ...h, context: contextOf(text, h.start) }));
}

/** `2025-03-12` as `12/03/2025`, the form shown to the lawyer. */
export const formatDate = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d ?? ''}/${m ?? ''}/${y ?? ''}`;
};

export function checkDates(
  mentions: readonly (Located & Omit<DateHit, 'start' | 'end' | 'raw'>)[],
  listing: readonly DateFact[],
  order: readonly DateFact[],
): Hit[] {
  const hits: Hit[] = [];
  for (const m of mentions) {
    if (m.context === null) continue;
    const facts = m.context === 'order' ? order : listing;
    if (facts.length === 0 || facts.some((f) => f.iso === m.iso)) continue;
    // The nearest date in the graph is the one the lawyer most likely meant.
    const day = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
    const target = [...facts].sort(
      (a, b) => Math.abs(day(a.iso) - day(m.iso)) - Math.abs(day(b.iso) - day(m.iso)),
    )[0];
    if (target === undefined) continue;
    const expected = formatDate(target.iso);
    hits.push({
      rule: m.context === 'order' ? 'date.order_mismatch' : 'date.listing_mismatch',
      severity: 'error',
      blockKey: m.blockKey,
      start: m.start,
      end: m.end,
      expected,
      found: m.raw,
      provenance: target.provenance,
      fix: { replacement: expected },
    });
  }
  return hits;
}
