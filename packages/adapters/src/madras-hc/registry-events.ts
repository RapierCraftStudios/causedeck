// Madras HC registry notices (#398, part 3 of #36). Before a filing gets a regular number the
// Registry assigns a Stamp Register (SR) number, returns defective papers via the seat for returns,
// gives a time to re-present and finally numbers the case (research/raw/08 §6):
//
//   SR.No.12345 of 2026 | S.R. No. 12345/2026                    -> sr_assigned (srNo `12345/2026`)
//   returned for rectification | defects | seat for returns      -> returned_for_defects
//   re-present within 7 days                                     -> cure_deadline {n, unit, basisDate, derived}
//   numbered as W.P.No. 678 of 2026                              -> numbered (caseRef)
//
// Every event is a proposal anchored to its printed words (L2 downstream), never a state change.
// `basisDate` is a date printed on the notice (`Date:`, `Dated`, `Returned on`); `derived` adds the
// period in calendar days, weeks or months and is null when the notice prints no basis date. Court
// holidays are not applied. Pure and total: it never throws.
import { expandYear } from '../normalise/case-number.ts';
import { normaliseDate } from '../normalise/date.ts';
import type { RegistryEvent, ParserInput } from '../types.ts';

import { parseCaseLine } from './case-line.ts';
import { MADRAS_HC_CASE_TYPE_ALIASES } from './config/case-types.ts';
import { REGISTRY_PHRASES } from './config/order-cues.ts';
import { documentPages } from './direction-cues.ts';

export interface RegistryEventOptions {
  /** Two-digit-year pivot (default 50). */
  pivot?: number;
  /** `nomenclature.caseTypes`; defaults to the Madras HC table. */
  aliases?: Readonly<Record<string, readonly string[]>>;
  seatSuffixes?: readonly string[];
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

/** Upper-case `SR` / `S.R.` only, so a serial number (`Sr.No.`) is not read as one. */
const SR = /\bS\.?\s*R\.?\s*No\.?\s*(\d{1,7})\s*(?:of|\/)\s*(\d{4}|\d{2})\b/;
const RETURNED = new RegExp(
  String.raw`(?<![A-Za-z])(?:${anyOf(REGISTRY_PHRASES.returned)})(?![A-Za-z])`,
  'i',
);
const CURE = new RegExp(
  String.raw`(?<![A-Za-z])(?:${anyOf(REGISTRY_PHRASES.rePresent)})\b[^.;]*?\bwithin\s+(\d{1,3}|${Object.keys(WORD_NUMBERS).join('|')})\s*(?:\(\s*\d{1,3}\s*\)\s*)?(days?|weeks?|months?)\b`,
  'i',
);
const NUMBERED = new RegExp(
  String.raw`(?<![A-Za-z])(?:${anyOf(REGISTRY_PHRASES.numbered)})\s+(.+)$`,
  'i',
);
const BASIS_LABEL =
  /^\s*(?:Date|Dated|Date\s+of\s+(?:return|notice)|Returned\s+on)\s*[:.-]?\s*(.+)$/i;

/** `basis` plus `n` calendar units, as an ISO date; months clamp to the month's last day. */
export function addPeriod(basis: string, n: number, unit: Unit): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(basis);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let date: Date;
  if (unit === 'months') {
    const last = new Date(Date.UTC(year, month - 1 + n + 1, 0)).getUTCDate();
    date = new Date(Date.UTC(year, month - 1 + n, Math.min(day, last)));
  } else {
    date = new Date(Date.UTC(year, month - 1, day + n * (unit === 'weeks' ? 7 : 1)));
  }
  return date.toISOString().slice(0, 10);
}

const unitOf = (raw: string): Unit =>
  raw.toLowerCase().startsWith('week')
    ? 'weeks'
    : raw.toLowerCase().startsWith('month')
      ? 'months'
      : 'days';

/** The registry events printed in a supplied notice, in reading order. Never throws. */
export function parseRegistryEvents(
  input: ParserInput,
  options: RegistryEventOptions = {},
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

      const sr = SR.exec(line);
      const year = sr === null ? null : expandYear(sr[2] ?? '', { pivot });
      if (sr !== null && year !== null) {
        found.push({
          at: sr.index,
          event: {
            kind: 'sr_assigned',
            anchor: anchor(sr[0]),
            confidence: 0.95,
            srNo: `${(sr[1] ?? '').replace(/^0+(?=\d)/, '')}/${String(year)}`,
          },
        });
      }

      const returned = RETURNED.exec(line);
      if (returned !== null) {
        found.push({
          at: returned.index,
          event: { kind: 'returned_for_defects', anchor: anchor(returned[0]), confidence: 0.8 },
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

      const numbered = NUMBERED.exec(line);
      if (numbered !== null) {
        const [ref] = parseCaseLine(numbered[1] ?? '', {
          pivot,
          aliases: options.aliases ?? MADRAS_HC_CASE_TYPE_ALIASES,
          seatSuffixes: options.seatSuffixes ?? ['MD'],
        }).refs;
        if (ref !== undefined) {
          found.push({
            at: numbered.index,
            event: {
              kind: 'numbered',
              anchor: anchor(numbered[0].trim()),
              confidence: 0.95,
              caseRef: ref,
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
