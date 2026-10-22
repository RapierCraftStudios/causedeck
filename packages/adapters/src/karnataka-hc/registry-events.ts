// Karnataka HC registry notices (#407, part 4 of #37). Before a filing is numbered the Registry
// gives it a Filing Register (FR) number, scrutinises it and lists office objections (defects) that
// the advocate must cure within a period:
//
//   FR No. 1234/2026 | F.R. No. 1234 of 2026 | Filing Register No. 1234/2026  -> fr_assigned (frNo)
//   office objections | objections | defects | returned                        -> objection_raised
//   to be cured within 7 days | comply within two weeks                        -> cure_deadline
//
// The same RegistryEvent shape and relative-deadline model as Madras (#36, #398): `basisDate` is a
// date printed on the notice (`Date:`, `Dated`, `Date of scrutiny`, `Returned on`) and `derived` adds
// the period in calendar days, weeks or months (null without a basis date; no court holidays).
// `file statement of objections` is an order direction and never an objection. Every event is a
// proposal anchored to its printed words, never a state change. Pure and total: it never throws.
import { documentPages } from '../madras-hc/direction-cues.ts';
import { addPeriod } from '../madras-hc/registry-events.ts';
import { expandYear } from '../normalise/case-number.ts';
import { normaliseDate } from '../normalise/date.ts';
import type { ParserInput, RegistryEvent } from '../types.ts';

import { KARNATAKA_HC_REGISTRY_PHRASES } from './config/order-cues.ts';

export interface KarnatakaRegistryEventOptions {
  /** Two-digit-year pivot (default 50). */
  pivot?: number;
}

type Unit = NonNullable<RegistryEvent['deadline']>['unit'];

const WORD_NUMBERS: Record<string, number> = {
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
  fifteen: 15,
  thirty: 30,
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const anyOf = (phrases: readonly string[]) =>
  phrases.map((p) => escape(p).replace(/\s+/g, String.raw`\s+`)).join('|');

/** Upper-case `FR` / `F.R.` only, so ordinary words ending in `fr` are never read as one. */
const FR =
  /(?:\bF\.?\s*R\.?|\b[Ff]iling\s+[Rr]egister|\bFILING\s+REGISTER)\s*[Nn][Oo]\.?\s*(\d{1,7})\s*(?:[Oo][Ff]|\/)\s*(\d{4}|\d{2})\b/;
const DECOY = new RegExp(
  String.raw`(?<![A-Za-z])(?:${anyOf(KARNATAKA_HC_REGISTRY_PHRASES.decoyPrefixes)})(?![A-Za-z])`,
  'gi',
);
const OBJECTION = new RegExp(
  String.raw`(?<![A-Za-z])(?:${anyOf(KARNATAKA_HC_REGISTRY_PHRASES.objection)})(?![A-Za-z])`,
  'i',
);
const CURE = new RegExp(
  String.raw`(?<![A-Za-z])(?:${anyOf(KARNATAKA_HC_REGISTRY_PHRASES.cure)})\s+(\d{1,3}|${Object.keys(WORD_NUMBERS).join('|')})\s*(?:\(\s*\d{1,3}\s*\)\s*)?(days?|weeks?|months?)\b`,
  'i',
);
const BASIS_LABEL =
  /^\s*(?:Date|Dated|Date\s+of\s+(?:scrutiny|return|notice)|Scrutiny\s+date|Returned\s+on)\s*[:.-]?\s*(.+)$/i;

const unitOf = (raw: string): Unit =>
  raw.toLowerCase().startsWith('week')
    ? 'weeks'
    : raw.toLowerCase().startsWith('month')
      ? 'months'
      : 'days';

/** Blanks decoy phrases (`statement of objections`) in place, so match offsets stay the same. */
const maskDecoys = (line: string) => line.replace(DECOY, (match) => ' '.repeat(match.length));

/** The Karnataka HC registry events printed in a supplied notice, in reading order. Never throws. */
export function parseKarnatakaRegistryEvents(
  input: ParserInput,
  options: KarnatakaRegistryEventOptions = {},
): RegistryEvent[] {
  const pivot = options.pivot ?? 50;
  const pages = documentPages(input);
  let basisDate: string | null = null;
  for (const line of pages.flatMap((page) => page.split('\n'))) {
    const label = BASIS_LABEL.exec(line);
    const date = label === null ? null : normaliseDate(label[1] ?? '', { pivot });
    if (date !== null) {
      basisDate = date;
      break;
    }
  }

  const events: RegistryEvent[] = [];
  pages.forEach((pageText, pageIndex) => {
    pageText.split('\n').forEach((line, rowIndex) => {
      const anchor = (quote: string) => ({ page: pageIndex + 1, quote, rowIndex });
      const found: { at: number; event: RegistryEvent }[] = [];

      const fr = FR.exec(line);
      const year = fr === null ? null : expandYear(fr[2] ?? '', { pivot });
      if (fr !== null && year !== null) {
        found.push({
          at: fr.index,
          event: {
            kind: 'fr_assigned',
            anchor: anchor(fr[0]),
            confidence: 0.95,
            frNo: `${(fr[1] ?? '').replace(/^0+(?=\d)/, '')}/${String(year)}`,
          },
        });
      }

      const objection = OBJECTION.exec(maskDecoys(line));
      if (objection !== null) {
        found.push({
          at: objection.index,
          event: {
            kind: 'objection_raised',
            anchor: anchor(line.slice(objection.index, objection.index + objection[0].length)),
            confidence: 0.8,
          },
        });
      }

      const cure = CURE.exec(line);
      if (cure !== null) {
        const raw = (cure[1] ?? '').toLowerCase();
        const n = /^\d+$/.test(raw) ? Number(raw) : (WORD_NUMBERS[raw] ?? 0);
        const unit = unitOf(cure[2] ?? '');
        if (n > 0) {
          found.push({
            at: cure.index,
            event: {
              kind: 'cure_deadline',
              anchor: anchor(cure[0]),
              confidence: 0.9,
              deadline: {
                n,
                unit,
                basisDate,
                derived: basisDate === null ? null : addPeriod(basisDate, n, unit),
              },
            },
          });
        }
      }

      found.sort((a, b) => a.at - b.at);
      events.push(...found.map((f) => f.event));
    });
  });
  return events;
}
