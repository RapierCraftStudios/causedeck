// Madras HC direction cues (#398, part 3 of #36). An order's operative part says what happens next:
//
//   Post on 12.11.2026 | call on | list on                       -> next_date (date only if printed)
//   List after four weeks | post the matter after two weeks       -> next_date_relative (no date)
//   counter within two weeks | file reply within 10 days          -> time_bound (no date)
//   Issue notice | Orders reserved | Notice dispensed with        -> notice, reserved, dispensed
//
// Each cue is one clause of one line: `text` and `anchor.quote` are that clause verbatim, `phrase` the
// matched words as printed and `anchor.rowIndex` the line on its page. Relative and time-bound cues
// are returned unresolved for the extractor (#46) and never become dates here. A date in a reference
// to an earlier order (`order dated 03.03.2019`) is masked first, so it is never a cue date. Pure.
import { normaliseDate } from '../normalise/date.ts';
import type { DirectionCue, ParserInput } from '../types.ts';

import {
  ABSOLUTE_DATE_PHRASES,
  DIRECTION_PHRASES,
  DISPENSED_PHRASES,
  EARLIER_ORDER_PREFIXES,
  NOTICE_PHRASES,
  RELATIVE_DATE_PHRASES,
  RESERVED_PHRASES,
  TIME_BOUND_PHRASES,
} from './config/order-cues.ts';

export type DirectionCueKind =
  | 'next_date'
  | 'next_date_relative'
  | 'time_bound'
  | 'notice'
  | 'reserved'
  | 'dispensed'
  | 'direction';

export interface DirectionCueOptions {
  /** `orderParser.directionPhrases`; defaults to the Madras HC phrases. */
  phrases?: readonly string[];
  /** Two-digit-year pivot (default 50). */
  pivot?: number;
}

/** The page texts of a supplied document: layout pages, or text split on form feeds. */
export function documentPages(input: ParserInput): string[] {
  if (input.layout !== undefined) return input.layout.pages.map((page) => page.text);
  return (input.text ?? '').split('\f');
}

const NUMERIC_DATE = String.raw`\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*(?:\d{4}|\d{2})\b`;
const WORDED_DATE = String.raw`\d{1,2}(?:st|nd|rd|th)?[\s-]+(?:day\s+of\s+)?[A-Za-z]{3,9}\.?,?[\s-]+\d{4}\b`;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseSource = (phrase: string) => escape(phrase).replace(/\s+/g, String.raw`\s+`);

const EARLIER_ORDER = new RegExp(
  String.raw`\b(?:${EARLIER_ORDER_PREFIXES.map(phraseSource).join('|')})\b[\s:,]*(?:the\s+)?(${NUMERIC_DATE}|${WORDED_DATE})`,
  'gi',
);

/**
 * `text` with every date that follows an earlier-order reference (`order dated 03.03.2019`)
 * replaced by `#`s of the same length, so offsets still line up with the original.
 */
export function maskEarlierOrderDates(text: string): string {
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

function kindOf(phrase: string): DirectionCueKind {
  const is = (list: readonly string[]) => list.includes(phrase);
  if (is(ABSOLUTE_DATE_PHRASES)) return 'next_date';
  if (is(RELATIVE_DATE_PHRASES)) return 'next_date_relative';
  if (is(TIME_BOUND_PHRASES)) return 'time_bound';
  if (is(NOTICE_PHRASES)) return 'notice';
  if (is(RESERVED_PHRASES)) return 'reserved';
  if (is(DISPENSED_PHRASES)) return 'dispensed';
  return 'direction';
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

/** The anchored direction cues of an order, in page and reading order. Never throws. */
export function findMadrasDirectionCues(
  input: ParserInput,
  options: DirectionCueOptions = {},
): DirectionCue[] {
  const phrases = [...new Set((options.phrases ?? DIRECTION_PHRASES).map((p) => p.toLowerCase()))]
    .filter((p) => p.trim() !== '')
    // Longer phrases first, so `post the matter after` wins over a shorter overlapping one.
    .sort((a, b) => b.length - a.length);
  const patterns = phrases.map((phrase) => ({
    phrase,
    re: new RegExp(String.raw`(?<![A-Za-z-])${phraseSource(phrase)}(?![A-Za-z])`, 'gi'),
  }));
  const cues: DirectionCue[] = [];
  documentPages(input).forEach((pageText, pageIndex) => {
    pageText.split('\n').forEach((line, rowIndex) => {
      for (const clause of clauses(line)) {
        const quote = clause.trim();
        if (quote === '') continue;
        const masked = maskEarlierOrderDates(quote);
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
            date =
              literal === null ? null : normaliseDate(literal[0], { pivot: options.pivot ?? 50 });
          }
          const confidence =
            kind === 'next_date'
              ? date === null
                ? 0.6
                : 0.95
              : kind === 'next_date_relative'
                ? hasDuration
                  ? 0.85
                  : 0.6
                : kind === 'time_bound'
                  ? 0.85
                  : 0.8;
          cues.push({
            kind,
            text: quote,
            phrase: hit.printed,
            anchor: { page: pageIndex + 1, quote, rowIndex },
            confidence,
            date,
          });
        }
      }
    });
  });
  return cues;
}
