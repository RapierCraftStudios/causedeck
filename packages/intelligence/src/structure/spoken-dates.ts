// The spoken-date parser (#541): English, Tamil and Kannada date phrases to `YYYY-MM-DD`, read
// against the hearing date. It is deterministic and works only from the transcript text: every
// date it returns carries the phrase and the character span it came from, so a date that cannot be
// traced to a span does not exist. The model never supplies a date; it may only point at a phrase.
//
// Conventions (ADR 0028): a date without a year is the first such date strictly after the hearing
// date; "on the 14th" is the first 14th after the hearing date; "next Tuesday" is the first Tuesday
// strictly after the hearing date; "after N weeks" is hearing date + 7N days; "after N months"
// keeps the day of month, clamped to the month's last day.

export interface Span {
  start: number;
  end: number;
}

export interface SpokenDate {
  /** `YYYY-MM-DD`. */
  date: string;
  /** The exact transcript text the date was read from. */
  phrase: string;
  span: Span;
  kind: 'absolute' | 'relative' | 'weekday';
}

interface Ymd {
  y: number;
  m: number;
  d: number;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
const toIso = ({ y, m, d }: Ymd): string => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

function parseIso(value: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const ymd = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  return isValid(ymd) ? ymd : null;
}

function isValid({ y, m, d }: Ymd): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const fromTime = (t: Date): Ymd => ({
  y: t.getUTCFullYear(),
  m: t.getUTCMonth() + 1,
  d: t.getUTCDate(),
});

const addDays = (h: Ymd, n: number): Ymd => fromTime(new Date(Date.UTC(h.y, h.m - 1, h.d + n)));

function addMonths(h: Ymd, n: number): Ymd {
  const index = h.y * 12 + (h.m - 1) + n;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const last = fromTime(new Date(Date.UTC(y, m, 0))).d;
  return { y, m, d: Math.min(h.d, last) };
}

/** The first valid `month`/`day` strictly after the hearing date (this year, then the next ones). */
function nextMonthDay(month: number, day: number, h: Ymd): Ymd | null {
  for (let y = h.y; y <= h.y + 8; y += 1) {
    const candidate = { y, m: month, d: day };
    if (isValid(candidate) && toIso(candidate) > toIso(h)) return candidate;
  }
  return null;
}

/** The first valid `day` of any month strictly after the hearing date. */
function nextDayOfMonth(day: number, h: Ymd): Ymd | null {
  for (let i = 0; i < 24; i += 1) {
    const base = addMonths({ y: h.y, m: h.m, d: 1 }, i);
    const candidate = { y: base.y, m: base.m, d: day };
    if (isValid(candidate) && toIso(candidate) > toIso(h)) return candidate;
  }
  return null;
}

function nextWeekday(weekday: number, h: Ymd): Ymd {
  const current = new Date(Date.UTC(h.y, h.m - 1, h.d)).getUTCDay();
  return addDays(h, (weekday - current + 7) % 7 || 7);
}

// ---------------------------------------------------------------------------------------------
// Vocabulary. Index i is the value i + 1 for number words; months and weekdays are 1-12 and 0-6.

const EN_UNITS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;
const EN_ORD_UNITS = [
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
] as const;

const EN_CARDINALS: string[] = [
  ...EN_UNITS,
  'twenty',
  ...EN_UNITS.slice(0, 9).map((u) => `twenty ${u}`),
  'thirty',
  'thirty one',
];
const EN_ORDINALS: string[] = [
  ...EN_ORD_UNITS,
  'twentieth',
  ...EN_ORD_UNITS.slice(0, 9).map((u) => `twenty ${u}`),
  'thirtieth',
  'thirty first',
];

const EN_MONTHS = [
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sept', 'sep'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
] as const;
const EN_WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const TA_CARDINALS = [
  'ஒன்று',
  'இரண்டு',
  'மூன்று',
  'நான்கு',
  'ஐந்து',
  'ஆறு',
  'ஏழு',
  'எட்டு',
  'ஒன்பது',
  'பத்து',
  'பதினொன்று',
  'பன்னிரண்டு',
  'பதின்மூன்று',
  'பதினான்கு',
  'பதினைந்து',
  'பதினாறு',
  'பதினேழு',
  'பதினெட்டு',
  'பத்தொன்பது',
  'இருபது',
  'இருபத்தொன்று',
  'இருபத்திரண்டு',
  'இருபத்துமூன்று',
  'இருபத்துநான்கு',
  'இருபத்தைந்து',
  'இருபத்தாறு',
  'இருபத்தேழு',
  'இருபத்தெட்டு',
  'இருபத்தொன்பது',
  'முப்பது',
  'முப்பத்தொன்று',
];
const TA_MONTHS = [
  'ஜனவரி',
  'பிப்ரவரி',
  'மார்ச்',
  'ஏப்ரல்',
  'மே',
  'ஜூன்',
  'ஜூலை',
  'ஆகஸ்ட்',
  'செப்டம்பர்',
  'அக்டோபர்',
  'நவம்பர்',
  'டிசம்பர்',
];
const TA_WEEKDAYS = [
  'ஞாயிற்றுக்கிழமை',
  'திங்கட்கிழமை',
  'செவ்வாய்க்கிழமை',
  'புதன்கிழமை',
  'வியாழக்கிழமை',
  'வெள்ளிக்கிழமை',
  'சனிக்கிழமை',
];

const KN_CARDINALS = [
  'ಒಂದು',
  'ಎರಡು',
  'ಮೂರು',
  'ನಾಲ್ಕು',
  'ಐದು',
  'ಆರು',
  'ಏಳು',
  'ಎಂಟು',
  'ಒಂಬತ್ತು',
  'ಹತ್ತು',
  'ಹನ್ನೊಂದು',
  'ಹನ್ನೆರಡು',
  'ಹದಿಮೂರು',
  'ಹದಿನಾಲ್ಕು',
  'ಹದಿನೈದು',
  'ಹದಿನಾರು',
  'ಹದಿನೇಳು',
  'ಹದಿನೆಂಟು',
  'ಹತ್ತೊಂಬತ್ತು',
  'ಇಪ್ಪತ್ತು',
  'ಇಪ್ಪತ್ತೊಂದು',
  'ಇಪ್ಪತ್ತೆರಡು',
  'ಇಪ್ಪತ್ತಮೂರು',
  'ಇಪ್ಪತ್ತನಾಲ್ಕು',
  'ಇಪ್ಪತ್ತೈದು',
  'ಇಪ್ಪತ್ತಾರು',
  'ಇಪ್ಪತ್ತೇಳು',
  'ಇಪ್ಪತ್ತೆಂಟು',
  'ಇಪ್ಪತ್ತೊಂಬತ್ತು',
  'ಮೂವತ್ತು',
  'ಮೂವತ್ತೊಂದು',
];
const KN_MONTHS = [
  'ಜನವರಿ',
  'ಫೆಬ್ರವರಿ',
  'ಮಾರ್ಚ್',
  'ಏಪ್ರಿಲ್',
  'ಮೇ',
  'ಜೂನ್',
  'ಜುಲೈ',
  'ಆಗಸ್ಟ್',
  'ಸೆಪ್ಟೆಂಬರ್',
  'ಅಕ್ಟೋಬರ್',
  'ನವೆಂಬರ್',
  'ಡಿಸೆಂಬರ್',
];
const KN_WEEKDAYS = ['ಭಾನುವಾರ', 'ಸೋಮವಾರ', 'ಮಂಗಳವಾರ', 'ಬುಧವಾರ', 'ಗುರುವಾರ', 'ಶುಕ್ರವಾರ', 'ಶನಿವಾರ'];

/** Tamil ordinal of a cardinal: `பதினான்கு` -> `பதினான்காம்`. */
export const taOrdinal = (cardinal: string): string => cardinal.replace(/ு$/u, 'ாம்');
/** Kannada ordinal of a cardinal: `ಹದಿನಾಲ್ಕು` -> `ಹದಿನಾಲ್ಕನೇ`. */
export const knOrdinal = (cardinal: string): string => cardinal.replace(/ು$/u, 'ನೇ');

export const SPOKEN_DATE_VOCABULARY = {
  en: { cardinals: EN_CARDINALS, ordinals: EN_ORDINALS, months: EN_MONTHS, weekdays: EN_WEEKDAYS },
  ta: { cardinals: TA_CARDINALS, months: TA_MONTHS, weekdays: TA_WEEKDAYS },
  kn: { cardinals: KN_CARDINALS, months: KN_MONTHS, weekdays: KN_WEEKDAYS },
} as const;

// ---------------------------------------------------------------------------------------------
// Pattern building.

const LEFT = String.raw`(?<![\p{L}\p{M}\p{N}])`;
const RIGHT = String.raw`(?![\p{L}\p{M}\p{N}])`;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const longestFirst = (words: readonly string[]): string[] =>
  [...words].sort((a, b) => b.length - a.length);
const alternation = (words: readonly string[]): string =>
  longestFirst(words)
    .map((w) => escape(w).replace(/ /g, '[-\\s]+'))
    .join('|');
const normaliseWords = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[-\s]+/g, ' ')
    .trim();

type Lookup = Map<string, number>;
const lookup = (words: readonly string[], offset = 1): Lookup =>
  new Map(words.map((w, i) => [normaliseWords(w), i + offset]));

const enCardinal = lookup(EN_CARDINALS);
const enOrdinal = lookup(EN_ORDINALS);
const enMonth: Lookup = new Map(
  EN_MONTHS.flatMap((names, i) => names.map((n): [string, number] => [n, i + 1])),
);
const enWeekday = lookup(EN_WEEKDAYS, 0);
const taCardinal = lookup(TA_CARDINALS);
const taOrdinalMap = lookup(TA_CARDINALS.map(taOrdinal));
const taMonth = lookup(TA_MONTHS);
const taWeekday = lookup(TA_WEEKDAYS, 0);
const knCardinal = lookup(KN_CARDINALS);
const knOrdinalMap = lookup(KN_CARDINALS.map(knOrdinal));
const knMonth = lookup(KN_MONTHS);
const knWeekday = lookup(KN_WEEKDAYS, 0);

const YEAR = String.raw`20\d{2}`;

interface Pattern {
  kind: SpokenDate['kind'];
  re: RegExp;
  resolve(groups: Record<string, string | undefined>, hearing: Ymd): Ymd | null;
}

function pattern(
  kind: Pattern['kind'],
  source: string,
  resolve: Pattern['resolve'],
  flags = 'giu',
): Pattern {
  return { kind, re: new RegExp(`${LEFT}(?:${source})${RIGHT}`, flags), resolve };
}

const numberOf = (token: string | undefined, ...maps: Lookup[]): number | null => {
  if (token === undefined) return null;
  if (/^\d+$/.test(token)) return Number(token);
  const key = normaliseWords(token);
  for (const map of maps) {
    const value = map.get(key);
    if (value !== undefined) return value;
  }
  return null;
};

const dayOf = (n: number | null): number | null => (n !== null && n >= 1 && n <= 31 ? n : null);

function absolute(
  g: Record<string, string | undefined>,
  h: Ymd,
  month: number | null,
  day: number | null,
): Ymd | null {
  if (month === null || day === null || month < 1 || month > 12) return null;
  if (g['y'] !== undefined) {
    const full = { y: Number(g['y']), m: month, d: day };
    return isValid(full) ? full : null;
  }
  return nextMonthDay(month, day, h);
}

function englishPatterns(): Pattern[] {
  const cardinals = alternation(EN_CARDINALS);
  const ordinals = alternation(EN_ORDINALS);
  const months = alternation(EN_MONTHS.flat());
  const weekdays = alternation(EN_WEEKDAYS);
  const day = `(?<d>\\d{1,2}(?:st|nd|rd|th)?|${ordinals}|${cardinals})`;
  const year = `(?:,?\\s+(?<y>${YEAR}))?`;
  const dayN = (g: Record<string, string | undefined>): number | null =>
    dayOf(numberOf(g['d']?.replace(/(?:st|nd|rd|th)$/i, ''), enOrdinal, enCardinal));
  const monthN = (g: Record<string, string | undefined>): number | null =>
    numberOf(g['mo']?.toLowerCase(), enMonth);
  const count = `(?<n>\\d{1,2}|${cardinals}|a)`;
  const countN = (g: Record<string, string | undefined>): number | null =>
    g['n']?.toLowerCase() === 'a' ? 1 : numberOf(g['n'], enCardinal);
  const unit = String.raw`(?<u>days?|weeks?|months?)`;
  const shift = (g: Record<string, string | undefined>, h: Ymd): Ymd | null => {
    const n = countN(g);
    if (n === null || n < 1 || n > 36) return null;
    const u = (g['u'] ?? '').toLowerCase();
    if (u.startsWith('day')) return addDays(h, n);
    if (u.startsWith('week')) return addDays(h, 7 * n);
    return addMonths(h, n);
  };
  return [
    pattern('absolute', `(?:the\\s+)?${day}\\s+(?:of\\s+)?(?<mo>${months})${year}`, (g, h) =>
      absolute(g, h, monthN(g), dayN(g)),
    ),
    pattern('absolute', `(?<mo>${months})\\s+(?:the\\s+)?${day}${year}`, (g, h) =>
      absolute(g, h, monthN(g), dayN(g)),
    ),
    pattern('absolute', String.raw`(?<d>\d{1,2})/(?<mo>\d{1,2})(?:/(?<y>\d{4}|\d{2}))?`, (g, h) => {
      const y = g['y'] === undefined ? undefined : g['y'].length === 2 ? `20${g['y']}` : g['y'];
      return absolute({ ...g, y }, h, numberOf(g['mo']), dayOf(numberOf(g['d'])));
    }),
    // A bare day: "on the 14th", "on the fourteenth" or "the 14th". "The first respondent" is not.
    pattern(
      'absolute',
      `on\\s+the\\s+(?<d>\\d{1,2}(?:st|nd|rd|th)|${ordinals})|the\\s+(?<d2>\\d{1,2}(?:st|nd|rd|th))`,
      (g, h) => {
        const d = dayN({ d: g['d'] ?? g['d2'] });
        return d === null ? null : nextDayOfMonth(d, h);
      },
    ),
    pattern('relative', `(?:after|in|within)\\s+${count}\\s+${unit}`, shift),
    pattern('relative', `${count}\\s+${unit}\\s+(?:later|from\\s+now)`, shift),
    pattern('weekday', `(?:next|coming)\\s+(?<w>${weekdays})`, (g, h) => {
      const w = enWeekday.get((g['w'] ?? '').toLowerCase());
      return w === undefined ? null : nextWeekday(w, h);
    }),
  ];
}

function indicPatterns(config: {
  cardinals: readonly string[];
  ordinalOf: (cardinal: string) => string;
  cardinalMap: Lookup;
  ordinalMap: Lookup;
  months: readonly string[];
  monthMap: Lookup;
  weekdays: readonly string[];
  weekdayMap: Lookup;
  /** Optional marker after a day number (`ஆம்`, `ನೇ`) and the date word (`தேதி`, `ತಾರೀಖು`). */
  suffix: string;
  dateWord: string;
  units: { day: readonly string[]; week: readonly string[]; month: readonly string[] };
  after: readonly string[];
  next: readonly string[];
}): Pattern[] {
  const cardinals = alternation(config.cardinals);
  const ordinals = alternation(config.cardinals.map(config.ordinalOf));
  const months = alternation(config.months);
  const weekdays = alternation(config.weekdays);
  const tail = `(?:\\s*${config.dateWord})?`;
  // A day is digits (with or without the ordinal suffix), an ordinal word or a cardinal word.
  const day = `(?<d>\\d{1,2}|${ordinals}|${cardinals})(?:${config.suffix})?`;
  const dayN = (g: Record<string, string | undefined>): number | null =>
    dayOf(numberOf(g['d'], config.ordinalMap, config.cardinalMap));
  const monthN = (g: Record<string, string | undefined>): number | null =>
    numberOf(g['mo'], config.monthMap);
  const year = `(?:,?\\s*(?<y>${YEAR}))?`;
  const unitWords = [...config.units.day, ...config.units.week, ...config.units.month];
  const shift = (g: Record<string, string | undefined>, h: Ymd): Ymd | null => {
    const n = numberOf(g['n'], config.cardinalMap);
    if (n === null || n < 1 || n > 36) return null;
    const u = g['u'] ?? '';
    if (config.units.day.includes(u)) return addDays(h, n);
    if (config.units.week.includes(u)) return addDays(h, 7 * n);
    return addMonths(h, n);
  };
  return [
    pattern(
      'absolute',
      `(?<mo>${months})\\s*${day}${tail}${year}`,
      (g, h) => absolute(g, h, monthN(g), dayN(g)),
      'giu',
    ),
    pattern('absolute', `${day}${tail}\\s+(?<mo>${months})${year}`, (g, h) =>
      absolute(g, h, monthN(g), dayN(g)),
    ),
    // A bare day needs the date word (or digits with the ordinal marker), so "the second party" and a
    // plain number are never dates.
    pattern(
      'absolute',
      `(?<d>\\d{1,2})${config.suffix}${tail}|(?<d2>${ordinals})\\s*${config.dateWord}|(?<d3>${cardinals}|\\d{1,2})\\s*${config.dateWord}`,
      (g, h) => {
        const token = g['d'] ?? g['d2'] ?? g['d3'];
        const d = dayOf(numberOf(token, config.ordinalMap, config.cardinalMap));
        return d === null ? null : nextDayOfMonth(d, h);
      },
    ),
    pattern('absolute', String.raw`(?<d>\d{1,2})/(?<mo>\d{1,2})(?:/(?<y>\d{4}|\d{2}))?`, (g, h) => {
      const y = g['y'] === undefined ? undefined : g['y'].length === 2 ? `20${g['y']}` : g['y'];
      return absolute({ ...g, y }, h, numberOf(g['mo']), dayOf(numberOf(g['d'])));
    }),
    pattern(
      'relative',
      `(?<n>\\d{1,2}|${cardinals})\\s*(?<u>${alternation(unitWords)})\\s*(?:${alternation(config.after)})`,
      shift,
    ),
    pattern('weekday', `(?:${alternation(config.next)})\\s+(?<w>${weekdays})`, (g, h) => {
      const w = config.weekdayMap.get(normaliseWords(g['w'] ?? ''));
      return w === undefined ? null : nextWeekday(w, h);
    }),
  ];
}

let compiled: Pattern[] | undefined;
function patterns(): Pattern[] {
  compiled ??= [
    ...englishPatterns(),
    ...indicPatterns({
      cardinals: TA_CARDINALS,
      ordinalOf: taOrdinal,
      cardinalMap: taCardinal,
      ordinalMap: taOrdinalMap,
      months: TA_MONTHS,
      monthMap: taMonth,
      weekdays: TA_WEEKDAYS,
      weekdayMap: taWeekday,
      suffix: 'ஆம்',
      dateWord: 'தேதி',
      units: {
        day: ['நாட்கள்', 'நாள்'],
        week: ['வாரங்கள்', 'வாரம்'],
        month: ['மாதங்கள்', 'மாதம்'],
      },
      after: ['கழித்து', 'பிறகு'],
      next: ['அடுத்த'],
    }),
    ...indicPatterns({
      cardinals: KN_CARDINALS,
      ordinalOf: knOrdinal,
      cardinalMap: knCardinal,
      ordinalMap: knOrdinalMap,
      months: KN_MONTHS,
      monthMap: knMonth,
      weekdays: KN_WEEKDAYS,
      weekdayMap: knWeekday,
      suffix: 'ನೇ',
      dateWord: 'ತಾರೀಖು',
      units: {
        day: ['ದಿನಗಳ', 'ದಿನ'],
        week: ['ವಾರಗಳ', 'ವಾರ'],
        month: ['ತಿಂಗಳ', 'ತಿಂಗಳು'],
      },
      after: ['ನಂತರ', 'ಬಳಿಕ'],
      next: ['ಮುಂದಿನ'],
    }),
  ];
  return compiled;
}

// ---------------------------------------------------------------------------------------------

/**
 * Every date phrase in `text`, resolved against `hearingDate` (`YYYY-MM-DD`). Overlapping matches
 * keep the longest; a phrase that names an impossible date (30 February) is skipped. Returns
 * nothing for an invalid hearing date.
 */
export function findSpokenDates(text: string, hearingDate: string): SpokenDate[] {
  const hearing = parseIso(hearingDate);
  if (hearing === null) return [];
  const found: SpokenDate[] = [];
  for (const p of patterns()) {
    p.re.lastIndex = 0;
    for (const match of text.matchAll(p.re)) {
      const phrase = match[0];
      if (phrase.length === 0) continue;
      const groups = { ...match.groups };
      const resolved = p.resolve(groups, hearing);
      if (resolved === null) continue;
      found.push({
        date: toIso(resolved),
        phrase,
        span: { start: match.index, end: match.index + phrase.length },
        kind: p.kind,
      });
    }
  }
  found.sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
  const kept: SpokenDate[] = [];
  for (const candidate of found) {
    const last = kept.at(-1);
    if (last === undefined || candidate.span.start >= last.span.end) kept.push(candidate);
  }
  return kept;
}

/** The date `phrase` states when the whole phrase is one date expression, else null. */
export function parseSpokenDate(phrase: string, hearingDate: string): string | null {
  const text = phrase.trim();
  const [only] = findSpokenDates(text, hearingDate);
  return only !== undefined && only.span.start === 0 && only.span.end === text.length
    ? only.date
    : null;
}
