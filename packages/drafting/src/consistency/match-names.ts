// Party-name matching: Unicode NFC, case folding, honorifics and initials ignored, aliases from the
// graph's `person.aliases` (transliteration variants, including Tamil and Kannada script). A name
// that matches no party but resembles one is a mismatch; names unrelated to every party are other
// people and are left alone.
import type { FindingProvenance } from '@causedeck/validators/consistency';

import type { Located } from './extract-entities';

export type PartyRole = 'petitioner' | 'respondent' | 'other';

export interface PartyFact {
  role: PartyRole;
  name: string;
  aliases: readonly string[];
  provenance: FindingProvenance;
}

export interface NameHit {
  start: number;
  end: number;
  raw: string;
  /** The party role the text names right after the person (`... the Petitioner`), if any. */
  role: Exclude<PartyRole, 'other'> | null;
}

/** A hit before it gets an id: what check.ts turns into a finding. */
export interface Hit {
  rule:
    | 'name.mismatch'
    | 'case_number.mismatch'
    | 'date.order_mismatch'
    | 'date.listing_mismatch'
    | 'annexure.missing'
    | 'annexure.duplicate'
    | 'annexure.gap'
    | 'annexure.unreferenced';
  severity: 'error' | 'warn' | 'info';
  blockKey: string;
  start: number;
  end: number;
  expected: string;
  found: string;
  provenance: FindingProvenance;
  fix?: { replacement: string };
}

const HONORIFIC_WORDS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'smt',
  'shri',
  'shrimati',
  'sri',
  'sree',
  'dr',
  'thiru',
  'tmt',
  'selvi',
  'kum',
  'kumari',
  'திரு',
  'திருமதி',
  'செல்வி',
  'ಶ್ರೀ',
  'ಶ್ರೀಮತಿ',
]);
const ROLE_WORDS: Record<string, Exclude<PartyRole, 'other'>> = {
  petitioner: 'petitioner',
  appellant: 'petitioner',
  applicant: 'petitioner',
  plaintiff: 'petitioner',
  respondent: 'respondent',
  defendant: 'respondent',
};
const STOP_WORDS = new Set(['the', 'and', 'vs', 'versus', 'who', 'was', 'is', 'has', 'had']);

const HONORIFIC =
  '(?:[Mm]rs|[Mm]r|[Mm]s|[Mm]iss|[Ss]mt|[Ss]hrimati|[Ss]hri|[Ss]ri|[Ss]ree|[Dd]r|[Tt]hiru|[Tt]mt|[Ss]elvi|[Kk]umari|[Kk]um|திருமதி|திரு|செல்வி|ಶ್ರೀಮತಿ|ಶ್ರೀ)';
const NAME_MENTION = new RegExp(
  `(?<![\\p{L}\\p{M}])${HONORIFIC}(?:\\.[ \\t]*|[ \\t]+)((?:[\\p{L}\\p{M}][\\p{L}\\p{M}.']*[ \\t]*){1,5})`,
  'gu',
);
const WORD = /[\p{L}\p{M}][\p{L}\p{M}.']*/gu;
const ROLE_LOOKAHEAD = 70;
const ROLE_BLOCKERS = /\b(advocate|counsel|for|on behalf|learned|vs?|versus|and)\b|;/i;
const ROLE_AFTER = /\b(petitioner|appellant|applicant|plaintiff|respondent|defendant)s?\b/i;

const isLowerStart = (w: string): boolean => {
  const c = Array.from(w)[0] ?? '';
  return c !== c.toUpperCase() && c === c.toLowerCase();
};
const codePoints = (s: string): number => Array.from(s).length;

export function findNameMentions(text: string): NameHit[] {
  const out: NameHit[] = [];
  for (const m of text.matchAll(NAME_MENTION)) {
    const group = m[1] ?? '';
    const groupStart = m.index + m[0].length - group.length;
    let first = -1;
    let last = -1;
    for (const w of group.matchAll(WORD)) {
      const word = w[0];
      const bare = word.replace(/\.$/, '').toLowerCase();
      if (isLowerStart(word) || STOP_WORDS.has(bare) || ROLE_WORDS[bare] !== undefined) break;
      if (first < 0) first = w.index;
      last = w.index + word.length;
      // A full word ending in a dot ends the sentence; `R.` style initials do not.
      if (word.endsWith('.') && codePoints(word) > 2) {
        last -= 1;
        break;
      }
    }
    if (first < 0) continue;
    const start = groupStart + first;
    const end = groupStart + last;
    const between = text.slice(end, end + ROLE_LOOKAHEAD);
    const role = ROLE_AFTER.exec(between);
    const linked =
      role !== null && !ROLE_BLOCKERS.test(between.slice(0, role.index))
        ? (ROLE_WORDS[role[1]?.toLowerCase() ?? ''] ?? null)
        : null;
    out.push({ start, end, raw: text.slice(start, end), role: linked });
  }
  return out;
}

interface Tokens {
  full: string[];
  initials: string[];
}

export function nameTokens(name: string): Tokens {
  const words = name
    .normalize('NFC')
    .toLowerCase()
    .split(/[\s.,'’]+/u)
    .filter((w) => w !== '' && !HONORIFIC_WORDS.has(w));
  return {
    full: words.filter((w) => codePoints(w) > 1),
    initials: words.filter((w) => codePoints(w) === 1),
  };
}

/** Same person: equal full tokens, initials standing for the other side's full tokens, or a partial name. */
export function namesMatch(a: string, b: string): boolean {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (x.full.length === 0 && x.initials.length === 0) return false;
  if (!x.full.every((t) => y.full.includes(t))) return false;
  const rest = y.full.filter((t) => !x.full.includes(t));
  if (x.initials.length === 0) return x.full.length > 0;
  // Each initial stands for one remaining full token of the other name, and each of those is covered.
  const pool = [...rest];
  for (const i of x.initials) {
    const at = pool.findIndex((t) => Array.from(t)[0] === i);
    if (at < 0) return false;
    pool.splice(at, 1);
  }
  return pool.length === 0;
}

function editDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[y.length] ?? 0;
}

/** The mention shares a name part with `candidate` (or is within two edits of one) yet is not it. */
export function resembles(mention: string, candidate: string): boolean {
  const x = nameTokens(mention).full;
  const y = nameTokens(candidate).full;
  return x.some((a) =>
    y.some(
      (b) =>
        (a === b && codePoints(a) >= 3) ||
        (codePoints(a) >= 5 && codePoints(b) >= 5 && editDistance(a, b) <= 2),
    ),
  );
}

const candidatesOf = (p: PartyFact): string[] => [p.name, ...p.aliases];

export function checkNames(
  mentions: readonly (Located & Pick<NameHit, 'role'>)[],
  parties: readonly PartyFact[],
): Hit[] {
  const hits: Hit[] = [];
  for (const m of mentions) {
    if (parties.some((p) => candidatesOf(p).some((c) => namesMatch(m.raw, c)))) continue;
    const ofRole = m.role === null ? [] : parties.filter((p) => p.role === m.role);
    const near = parties.find((p) => candidatesOf(p).some((c) => resembles(m.raw, c)));
    const target = near ?? ofRole[0];
    if (target === undefined) continue;
    hits.push({
      rule: 'name.mismatch',
      severity: 'error',
      blockKey: m.blockKey,
      start: m.start,
      end: m.end,
      expected: target.name,
      found: m.raw,
      provenance: target.provenance,
      fix: { replacement: target.name },
    });
  }
  return hits;
}
