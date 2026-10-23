// The deterministic pre-parse (#46): runs first, over every page, and finds the candidates the
// model is later held to: date literals (each classified as the order date, a next-date cue, a
// decoy or other), case numbers, neutral citations, bench names, direction cues and
// instruction-like text. Nothing here is a decision; `validate.ts` decides what survives.
import { findDateLiterals, mapIndicDigits, type DateLiteral } from './dates.ts';
import { addInterval, findRelativePhrases, RELATIVE_RULE, type Derivation } from './relative.ts';
import type { PageText } from './anchors.ts';

export interface Span {
  page: number;
  start: number;
  end: number;
  /** Verbatim text of `[start, end)` on the page. */
  quote: string;
}

export type DateRole = 'order' | 'next' | 'decoy' | 'other';

export interface DateCandidate extends Span {
  date: string;
  role: DateRole;
  /** The cue words before a `next` date. */
  cue?: string;
}

export interface NextDateCandidate extends Span {
  date: string;
  /** The cue and date as written (the span's quote). */
  phrase: string;
  derived: boolean;
  derivation?: Derivation;
  source: 'preparse' | 'model';
}

export interface DirectionCue extends Span {
  cue: string;
  /** `within N units` when the cue carries a compliance period. */
  dueExpression?: string;
}

export interface NamedSpan extends Span {
  value: string;
}

export interface PreParse {
  dates: DateCandidate[];
  orderDate: DateCandidate | null;
  nextDates: NextDateCandidate[];
  caseNumbers: NamedSpan[];
  neutralCitations: NamedSpan[];
  bench: NamedSpan[];
  directionCues: DirectionCue[];
  /** Instruction-like text was found in the order. */
  suspicious: boolean;
}

const NEXT_CUE =
  /(post(?:ed)?|list(?:ed)?|call|put\s+up|come\s+up|adjourn(?:ed)?|taken\s+up|next\s+(?:date|hearing)|for\s+(?:further\s+)?(?:hearing|orders|compliance|arguments|reply|counter))\b[^;\n]*$/i;
const DECOY =
  /(order(?:s)?\s+(?:dated|passed|of|made)|judg(?:e)?ment\s+(?:dated|of)|impugned|notification|g\.?o\.?\s|section\s+\d|limitation|statute|statutory|filed\s+on|born|birth|incident|agreement|f\.?i\.?r|dated|vide|within\s+a\s+period)\b[^;\n]*$/i;
// The label must start its line ("Dated: ..."): "the order dated ..." is a reference, not the date.
const ORDER_DATE_LEAD =
  /(?:^|[\n|])\s*(?:date(?:d)?|date\s+of\s+(?:order|judgment)|pronounced\s+on|delivered\s+on|order\s+date)\s*[:-]?\s*$/i;
const SENTENCE_BREAK = /(?:\.\s|;|\n\s*\n)/g;

const CASE_NUMBER =
  /\b((?:W\.?P\.?|W\.?A\.?|W\.?M\.?P\.?|C\.?M\.?P\.?|C\.?R\.?P\.?|S\.?A\.?|O\.?S\.?A\.?|C\.?S\.?|Crl\.?\s?(?:O\.?P\.?|A\.?|R\.?C\.?)|T\.?C\.?A\.?|M\.?F\.?A\.?|R\.?F\.?A\.?|F\.?A\.?|O\.?A\.?|I\.?A\.?|C\.?P\.?|C\.?A\.?|SLP|CC)(?:\s?\((?:MD|C|Crl|PIL)\))?)\s*(?:Nos?\.?\s*)?(\d{1,6})\s*(?:\/|of)\s*(\d{4})\b/g;
const NEUTRAL_CITATION =
  /\b20\d{2}:[A-Z]{2,6}(?:-[A-Z]{1,3})?:\d{1,7}\b|\b20\d{2}\s+INSC\s+\d{1,5}\b/g;
// "Justice" counts only after a title (Hon'ble, Mr., Ms., Dr...), so "in the interests of justice"
// is not a judge. Words stay on one line.
const BENCH =
  /(?<=(?:hon['’]?ble|mr\.?|ms\.?|mrs\.?|dr\.?|smt\.?|shri)[ \t]+(?:the[ \t]+)?(?:(?:mr|ms|mrs|dr|smt|shri)\.?[ \t]+)?)justice[ \t]+((?:[A-Za-z][A-Za-z.'’]*[ \t]+){0,3}[A-Za-z][A-Za-z.'’]*)/gi;
const BENCH_STOP = new Set([
  'and',
  'order',
  'judgment',
  'judgement',
  'common',
  'dated',
  'on',
  'in',
  'the',
  'heard',
  'is',
  'was',
  'has',
  'passed',
  'made',
  'for',
  'to',
  'by',
  'vs',
  'v',
  'of',
  'at',
  'sitting',
  'presiding',
]);
const DIRECTION_CUE =
  /\b(counter(?:\s+affidavit)?|reply|rejoinder|compliance|status\s+report)\b[^.\n]{0,40}?\bwithin\s+(?:a\s+period\s+of\s+)?[a-z0-9-]+(?:\s*\(\d+\))?\s*(?:day|week|month)s?\b|\b(orders?\s+reserved|dispensed\s+with|notice\s+(?:is\s+)?ordered|file\s+(?:the\s+)?(?:counter|reply|rejoinder|vakalat)[^.\n]{0,40})/gi;
const INJECTION = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\b/i,
  /disregard\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|instructions)/i,
  /(?:set|change|update)\s+the\s+next\s+(?:date|hearing)\s+to\b/i,
  /(^|\n)\s*(system|assistant|developer)\s*:/i,
  /you\s+are\s+now\b/i,
  /new\s+instructions?\s*:/i,
  /as\s+an\s+ai\b/i,
];

/** True when `text` holds instruction-like content aimed at a model. */
export function looksLikeInjection(text: string): boolean {
  return INJECTION.some((p) => p.test(text));
}

const span = (page: PageText, start: number, end: number): Span => ({
  page: page.pageNo,
  start,
  end,
  quote: page.text.slice(start, end),
});

/** The current sentence's text before `index` (dates contain dots, so only ". " breaks it). */
function sentenceBefore(text: string, index: number): string {
  const window = text.slice(Math.max(0, index - 160), index);
  let cut = 0;
  for (const m of window.matchAll(SENTENCE_BREAK)) cut = m.index + m[0].length;
  return window.slice(cut);
}

function classify(page: PageText, literal: DateLiteral): { role: DateRole; cue?: string } {
  const before = sentenceBefore(page.text, literal.start);
  // A date inside instruction-like text is never a candidate (it would be the attacker's).
  if (looksLikeInjection(before)) return { role: 'decoy' };
  if (page.pageNo === 1 && literal.start < 1200 && ORDER_DATE_LEAD.test(before)) {
    return { role: 'order' };
  }
  const cue = NEXT_CUE.exec(before);
  const decoy = DECOY.exec(before);
  if (cue !== null && (decoy === null || decoy.index < cue.index)) {
    return { role: 'next', cue: cue[0].slice(0, 80) };
  }
  return { role: decoy === null ? 'other' : 'decoy' };
}

export function preParse(pages: readonly PageText[]): PreParse {
  const dates: DateCandidate[] = [];
  const caseNumbers: NamedSpan[] = [];
  const neutralCitations: NamedSpan[] = [];
  const bench: NamedSpan[] = [];
  const directionCues: DirectionCue[] = [];
  let suspicious = false;

  for (const page of pages) {
    for (const literal of findDateLiterals(page.text)) {
      const { role, cue } = classify(page, literal);
      dates.push({
        ...span(page, literal.start, literal.end),
        date: literal.date,
        role,
        ...(cue === undefined ? {} : { cue }),
      });
    }
    const digits = mapIndicDigits(page.text);
    for (const m of digits.matchAll(CASE_NUMBER)) {
      caseNumbers.push({ ...span(page, m.index, m.index + m[0].length), value: m[0].trim() });
    }
    for (const m of page.text.matchAll(NEUTRAL_CITATION)) {
      neutralCitations.push({ ...span(page, m.index, m.index + m[0].length), value: m[0] });
    }
    for (const m of page.text.matchAll(BENCH)) {
      const words = (m[1] ?? '').split(/\s+/);
      const keep: string[] = [];
      for (const w of words) {
        if (BENCH_STOP.has(w.toLowerCase().replace(/[.,]/g, ''))) break;
        keep.push(w);
      }
      if (keep.length === 0) continue;
      const name = keep.join(' ').replace(/[.,]+$/, '');
      // The quote runs from "Justice" through the last kept name word.
      const nameAt = m[0].length - (m[1] ?? '').length;
      bench.push({ ...span(page, m.index, m.index + nameAt + name.length), value: name });
    }
    for (const m of page.text.matchAll(DIRECTION_CUE)) {
      const within = findRelativePhrases(m[0]).find((r) => r.preposition === 'within');
      directionCues.push({
        ...span(page, m.index, m.index + m[0].length),
        cue: (m[1] ?? m[2] ?? '').toLowerCase().replace(/\s+/g, ' '),
        ...(within === undefined ? {} : { dueExpression: within.phrase }),
      });
    }
    if (looksLikeInjection(page.text)) suspicious = true;
  }

  const orderDate = dates.find((d) => d.role === 'order') ?? null;
  const nextDates: NextDateCandidate[] = dates
    .filter((d) => d.role === 'next')
    .map((d) => ({
      page: d.page,
      start: d.start,
      end: d.end,
      quote: d.quote,
      date: d.date,
      phrase: d.quote,
      derived: false,
      source: 'preparse' as const,
    }));

  if (orderDate !== null) {
    for (const page of pages) {
      for (const rel of findRelativePhrases(page.text)) {
        if (rel.preposition !== 'after') continue;
        const before = sentenceBefore(page.text, rel.start);
        if (
          !/(?:list(?:ed)?|post(?:ed)?|call|put\s+up|come\s+up|re-?notify|adjourn(?:ed)?)\b[^;\n]*$/i.test(
            before,
          )
        )
          continue;
        if (DECOY.test(before) && !/(list|post)/i.test(before)) continue;
        nextDates.push({
          page: page.pageNo,
          start: rel.start,
          end: rel.end,
          quote: rel.phrase,
          date: addInterval(orderDate.date, rel.n, rel.unit),
          phrase: rel.phrase,
          derived: true,
          derivation: { basis: 'orderDate', n: rel.n, unit: rel.unit, rule: RELATIVE_RULE },
          source: 'preparse',
        });
      }
    }
  }

  return {
    dates,
    orderDate,
    nextDates,
    caseNumbers,
    neutralCitations,
    bench,
    directionCues,
    suspicious,
  };
}
