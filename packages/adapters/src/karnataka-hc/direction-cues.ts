// Karnataka HC direction cues (#406, part 3 of #37). An order's operative part says what happens next:
//
//   List on 12.11.2026 | call on | post on | adjourned to            -> next_date (date only if printed)
//   List after two weeks | list the matter after | post after       -> next_date_relative (no date)
//   file statement of objections within four weeks                  -> time_bound (no date)
//   Issue notice | Rule | Orders reserved                           -> notice, rule, reserved
//
// Each cue is one clause of one line: `text` and `anchor.quote` are that clause verbatim, `phrase` the
// matched words as printed and `anchor.rowIndex` the line on its page. Relative and time-bound cues
// are returned unresolved for the extractor (#46) and never become dates here. A date in a reference
// to an earlier or impugned order (`impugned order dated 03.03.2019`) is masked first, so it is never
// a cue date. Pure and total.
import { documentPages } from '../madras-hc/direction-cues.ts';
import { normaliseDate } from '../normalise/date.ts';
import type { DirectionCue, ParserInput } from '../types.ts';

import {
  KARNATAKA_HC_ABSOLUTE_DATE_PHRASES,
  KARNATAKA_HC_DIRECTION_PHRASES,
  KARNATAKA_HC_EARLIER_ORDER_PREFIXES,
  KARNATAKA_HC_NOTICE_PHRASES,
  KARNATAKA_HC_RELATIVE_DATE_PHRASES,
  KARNATAKA_HC_RESERVED_PHRASES,
  KARNATAKA_HC_RULE_PHRASES,
  KARNATAKA_HC_TIME_BOUND_PHRASES,
} from './config/order-cues.ts';

export type KarnatakaDirectionCueKind =
  'next_date' | 'next_date_relative' | 'time_bound' | 'notice' | 'rule' | 'reserved' | 'direction';

export interface KarnatakaDirectionCueOptions {
  /** `orderParser.directionPhrases`; defaults to the Karnataka HC phrases. */
  phrases?: readonly string[];
  /** Two-digit-year pivot (default 50). */
  pivot?: number;
}

const NUMERIC_DATE = String.raw`\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*(?:\d{4}|\d{2})\b`;
const WORDED_DATE = String.raw`\d{1,2}(?:st|nd|rd|th)?[\s-]+(?:day\s+of\s+)?[A-Za-z]{3,9}\.?,?[\s-]+\d{4}\b`;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseSource = (phrase: string) => escape(phrase).replace(/\s+/g, String.raw`\s+`);

const EARLIER_ORDER = new RegExp(
  String.raw`\b(?:${KARNATAKA_HC_EARLIER_ORDER_PREFIXES.map(phraseSource).join('|')})\b[\s:,]*(?:the\s+)?(${NUMERIC_DATE}|${WORDED_DATE})`,
  'gi',
);

/**
 * `text` with every date that follows an earlier- or impugned-order reference replaced by `#`s of
 * the same length, so offsets still line up with the original.
 */
export function maskKarnatakaEarlierOrderDates(text: string): string {
  return text.replace(EARLIER_ORDER, (whole, date: string) => {
    const at = whole.lastIndexOf(date);
    return `${whole.slice(0, at)}${'#'.repeat(date.length)}`;
  });
}

const DURATION = String.raw`(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|thirty|a|an)\s*(?:\(\s*\d{1,3}\s*\)\s*)?(?:days?|weeks?|months?)\b`;
const FOLLOWED_BY_DURATION = new RegExp(String.raw`^\s+${DURATION}`, 'i');
const DATE_AT_START = new RegExp(
  String.raw`^[\s:,-]*(?:the\s+)?(?:${NUMERIC_DATE}|${WORDED_DATE})`,
  'i',
);

function kindOf(phrase: string): KarnatakaDirectionCueKind {
  const is = (list: readonly string[]) => list.includes(phrase);
  if (is(KARNATAKA_HC_ABSOLUTE_DATE_PHRASES)) return 'next_date';
  if (is(KARNATAKA_HC_RELATIVE_DATE_PHRASES)) return 'next_date_relative';
  if (is(KARNATAKA_HC_TIME_BOUND_PHRASES)) return 'time_bound';
  if (is(KARNATAKA_HC_NOTICE_PHRASES)) return 'notice';
  if (is(KARNATAKA_HC_RULE_PHRASES)) return 'rule';
  if (is(KARNATAKA_HC_RESERVED_PHRASES)) return 'reserved';
  return 'direction';
}

function confidenceOf(kind: KarnatakaDirectionCueKind, dated: boolean, hasDuration: boolean) {
  if (kind === 'next_date') return dated ? 0.95 : 0.6;
  if (kind === 'next_date_relative') return hasDuration ? 0.85 : 0.6;
  if (kind === 'time_bound') return 0.85;
  return 0.8;
}

/** A line split into clauses at `;` and at a sentence-ending full stop before a capital. */
function clauses(line: string): string[] {
  const out: string[] = [];
  const boundary = /;\s*|(?<=[a-z0-9)]\.)\s+(?=[A-Z(])/g;
  let start = 0;
  for (const match of line.matchAll(boundary)) {
    out.push(line.slice(start, match.index));
    start = match.index + match[0].length;
  }
  out.push(line.slice(start));
  return out;
}

interface Hit {
  phrase: string;
  printed: string;
  index: number;
  end: number;
}

/** The anchored direction cues of a Karnataka HC order, in page and reading order. Never throws. */
export function findKarnatakaDirectionCues(
  input: ParserInput,
  options: KarnatakaDirectionCueOptions = {},
): DirectionCue[] {
  const phrases = [
    ...new Set((options.phrases ?? KARNATAKA_HC_DIRECTION_PHRASES).map((p) => p.toLowerCase())),
  ]
    .filter((p) => p.trim() !== '')
    // Longer phrases first, so `list the matter after` wins over a shorter overlapping one.
    .sort((a, b) => b.length - a.length);
  const patterns = phrases.map((phrase) => ({
    phrase,
    re: new RegExp(String.raw`(?<![A-Za-z-])${phraseSource(phrase)}(?![A-Za-z])`, 'gi'),
  }));
  const pivot = options.pivot ?? 50;
  const cues: DirectionCue[] = [];
  documentPages(input).forEach((pageText, pageIndex) => {
    pageText.split('\n').forEach((line, rowIndex) => {
      for (const clause of clauses(line)) {
        const quote = clause.trim();
        if (quote === '') continue;
        const masked = maskKarnatakaEarlierOrderDates(quote);
        const hits: Hit[] = [];
        for (const { phrase, re } of patterns) {
          for (const match of masked.matchAll(re)) {
            const index = match.index;
            const end = index + match[0].length;
            if (hits.some((hit) => index < hit.end && end > hit.index)) continue;
            hits.push({ phrase, printed: quote.slice(index, end), index, end });
          }
        }
        hits.sort((a, b) => a.index - b.index);
        for (const hit of hits) {
          const kind = kindOf(hit.phrase);
          const rest = masked.slice(hit.end);
          const hasDuration = FOLLOWED_BY_DURATION.test(rest);
          if (kind === 'time_bound' && !hasDuration) continue;
          let date: string | null = null;
          if (kind === 'next_date') {
            const literal = DATE_AT_START.exec(rest);
            // `12TH NOVEMBER, 2026`: the date normaliser reads ordinal suffixes in lower case.
            date = literal === null ? null : normaliseDate(literal[0].toLowerCase(), { pivot });
          }
          cues.push({
            kind,
            text: quote,
            phrase: hit.printed,
            anchor: { page: pageIndex + 1, quote, rowIndex },
            confidence: confidenceOf(kind, date !== null, hasDuration),
            date,
          });
        }
      }
    });
  });
  return cues;
}
