// Name shapes shared by the role detector (#892): honorifics, name tokens, institutions.

export const HONORIFIC = String.raw`(?:Smt|Shri|Sri|Mr|Mrs|Ms|Miss|Dr|Kum|Master|Late|Shrimati|Km)\.?`;
/** One to four capitalised words (initials allowed); never crosses a line. */
export const NAME = String.raw`(?:[A-Z]\.|[A-Z][A-Za-z'’-]*)(?:[ \t]+(?:[A-Z]\.|[A-Z][A-Za-z'’-]*)){0,3}`;

/** A case-insensitive spelling of `word` that keeps the surrounding pattern case-sensitive. */
export const ci = (word: string): string =>
  word
    .split('')
    .map((c) => (/[a-z]/i.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c))
    .join('');
export const anyOf = (words: readonly string[]): string => `(?:${words.map(ci).join('|')})`;

export const PARTY_ROLES = [
  'petitioner',
  'appellant',
  'respondent',
  'accused',
  'complainant',
  'plaintiff',
  'defendant',
  'applicant',
  'informant',
  'victim',
  'prosecutrix',
  'survivor',
  'witness',
] as const;

/** Words that end a name: designations, role words and connectives. */
const TRAILING = new Set(
  [
    'advocate',
    'advocates',
    'counsel',
    'learned',
    'senior',
    'additional',
    'standing',
    'for',
    'the',
    'and',
    'versus',
    'vs',
    'v',
    'petitioner',
    'appellant',
    'respondent',
    'accused',
    'complainant',
    'plaintiff',
    'defendant',
    'applicant',
    'informant',
    'victim',
    'appeared',
    'appearing',
    'who',
    'was',
    'is',
    'has',
    'had',
    'in',
    'on',
    'at',
    'by',
    'of',
    'aged',
    'being',
    'then',
    'also',
    'but',
    'when',
    'while',
    'where',
    'that',
    'this',
    'would',
    'did',
    'does',
    'with',
    'as',
    'to',
    'from',
    'before',
    'after',
    'states',
    'stated',
    'deposed',
    'submits',
    'submitted',
    'contends',
    'contended',
  ].map((w) => w.toLowerCase()),
);

/** Words a person's name never starts with. */
const LEADING_STOP = new Set(
  [
    'the',
    'this',
    'that',
    'state',
    'union',
    'government',
    'court',
    'high',
    'supreme',
    'bench',
    'section',
    'article',
    'act',
    'rule',
    'code',
    'police',
    'order',
    'judgment',
    'learned',
    'in',
    'on',
    'it',
    'he',
    'she',
    'they',
    'we',
    'a',
    'an',
    'accused',
    'petitioner',
    'respondent',
    'appellant',
    'complainant',
    'victim',
    'no',
    'nos',
    'and',
    'learned',
    'but',
    'however',
    'further',
    'hence',
    'thus',
    'therefore',
    'since',
    'if',
    'having',
    'heard',
    'mr',
    'mrs',
    'ms',
    'smt',
    'shri',
    'sri',
    'dr',
  ].map((w) => w.toLowerCase()),
);

const INSTITUTION =
  /\b(?:State|Union|Government|Govt|Ltd|Limited|Pvt|Private|Bank|Corporation|Board|Commission|Commissioner|Department|Ministry|Company|University|Municipal|Municipality|Authority|Police|Secretary|Registrar|Collector|Inspector|Tribunal|Committee|Council|Trust|Society|Association|Institute|Council|Railway|Railways|Insurance|Industries|Enterprises|Corp|Court|Station|Panchayat|Revenue|Magistrate|Officer|Director|Directorate|Authority|India|Kerala|Karnataka|Tamil\s+Nadu|Maharashtra|Delhi)\b/i;

/** True for a state, company, court or other body that stays in the text. */
export const isInstitution = (name: string): boolean => INSTITUTION.test(name);

/** Trim connective and designation words off a captured name; null when no person name is left. */
export function trimName(raw: string): string | null {
  const words = raw.trim().split(/[ \t]+/);
  while (words.length > 0 && TRAILING.has((words.at(-1) ?? '').replace(/[.,]$/, '').toLowerCase())) {
    words.pop();
  }
  const first = (words[0] ?? '').replace(/[.,]$/, '').toLowerCase();
  if (words.length === 0 || LEADING_STOP.has(first)) return null;
  const name = words.join(' ').replace(/[,.;:]+$/, '');
  if (name.replace(/[^A-Za-z]/g, '').length < 3) return null;
  return isInstitution(name) ? null : name;
}

/** Lower-case tokens of a name without punctuation. */
export const tokensOf = (name: string): string[] =>
  name
    .toLowerCase()
    .replace(/[.,'’]/g, ' ')
    .split(/\s+/)
    .filter((t) => t !== '');

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const GENERIC = new Set(['late', 'smt', 'shri', 'sri', 'mrs', 'miss', 'kum', 'master', 'bin', 'devi']);
/** A token of a party name that is safe to replace on its own (a real name part, not a title). */
export const isSafeToken = (t: string): boolean =>
  t.length >= 3 && !GENERIC.has(t) && !TRAILING.has(t) && !LEADING_STOP.has(t);
