// Relative dates (#46): "list after four weeks" is computed here, from the anchored phrase and the
// order date, never by the model. The rule is deliberately plain and always shown with the result:
// days are calendar days, a week is 7 days, a month is a calendar month (same day of the month, or
// the last day of a shorter month). No holiday or vacation adjustment is applied.

export type RelativeUnit = 'day' | 'week' | 'month';

export const RELATIVE_RULE =
  'calendar days; 1 week = 7 days; 1 month = same day next calendar month (clamped to month end); no holiday or vacation adjustment';

export interface Derivation {
  basis: 'orderDate';
  n: number;
  unit: RelativeUnit;
  rule: string;
}

export interface RelativePhrase {
  /** `after` lists the matter then; `within` is a compliance period. */
  preposition: 'after' | 'within';
  n: number;
  unit: RelativeUnit;
  phrase: string;
  start: number;
  end: number;
}

export interface ResolvedRelative {
  date: string;
  derivation: Derivation;
  derived: true;
}

const WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  ninety: 90,
};
const NUMBER_WORD = Object.keys(WORDS).join('|');
const AMOUNT = `(?:\\d{1,3}|(?:${NUMBER_WORD})(?:[\\s-](?:one|two|three|four|five|six|seven|eight|nine))?)`;
const RELATIVE = new RegExp(
  `\\b(after|within)\\s+(?:a\\s+period\\s+of\\s+)?(${AMOUNT})\\s*(?:\\(\\d+\\)\\s*)?(day|week|month)s?\\b`,
  'gi',
);

function amountOf(raw: string): number | null {
  const text = raw.toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(/[\s-]+/);
  const values = parts.map((p) => WORDS[p]);
  if (values.some((v) => v === undefined)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

/** Every "after/within N days|weeks|months" phrase in `text`. */
export function findRelativePhrases(text: string): RelativePhrase[] {
  const out: RelativePhrase[] = [];
  for (const m of text.matchAll(RELATIVE)) {
    const n = amountOf(m[2] ?? '');
    if (n === null || n < 1) continue;
    out.push({
      preposition: (m[1] ?? '').toLowerCase() as 'after' | 'within',
      n,
      unit: (m[3] ?? '').toLowerCase() as RelativeUnit,
      phrase: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/** `orderDate` (`YYYY-MM-DD`) plus `n` units under `RELATIVE_RULE`. */
export function addInterval(orderDate: string, n: number, unit: RelativeUnit): string {
  const [y = 0, mo = 1, d = 1] = orderDate.split('-').map(Number);
  if (unit === 'month') {
    const total = y * 12 + (mo - 1) + n;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return new Date(Date.UTC(year, month - 1, Math.min(d, last))).toISOString().slice(0, 10);
  }
  const days = unit === 'week' ? n * 7 : n;
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

/** Resolve the first relative phrase in `phrase` against `orderDate`; null if there is none. */
export function resolveRelative(phrase: string, orderDate: string): ResolvedRelative | null {
  const found = findRelativePhrases(phrase)[0];
  if (found === undefined) return null;
  return {
    date: addInterval(orderDate, found.n, found.unit),
    derivation: { basis: 'orderDate', n: found.n, unit: found.unit, rule: RELATIVE_RULE },
    derived: true,
  };
}
