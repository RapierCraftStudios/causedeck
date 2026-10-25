// Madras HC order header (#398, part 3 of #36). A daily order, an interim order or a judgment opens
// with a header block before its `ORDER` / `COMMON ORDER` / `JUDGMENT` title line:
//
//   IN THE HIGH COURT OF JUDICATURE AT MADRAS
//   DATED: 21.10.2026                                  -> orderDate (a header label only)
//   CORAM                                              -> bench, judges[]
//   THE HONOURABLE MR.JUSTICE A. FICTIONAL
//   W.P.No.12345 of 2026 and W.M.P.No.13001 of 2026    -> caseRefs (case-line grammar)
//   2026:MHC:1234 | 2026/MHC/1234                      -> neutralCitation, neutralCitationRaw
//
// The order date is read only from a header label (`DATED`, `Date of order`, `Pronounced on`), so a
// reference to an earlier order in the body (`order dated 03.03.2019`) is never the order date.
// `orderType` is `judgment` from the title line, else `final` or `interim` from the body's cues
// (`ORDER_TYPE_CUES`), else `daily` for an order with a title or a direction cue. Pure and total.
import { normaliseDate } from '../normalise/date.ts';
import type { CaseRef, ParsedOrderHeader, ParserInput } from '../types.ts';

import { parseCaseLine } from './case-line.ts';
import { MADRAS_HC_CASE_TYPE_ALIASES } from './config/case-types.ts';
import { ORDER_TYPE_CUES } from './config/order-cues.ts';
import { documentPages, findMadrasDirectionCues, maskEarlierOrderDates } from './direction-cues.ts';
import { findNeutralCitation } from './neutral-citation.ts';

export interface OrderHeaderOptions {
  /** Two-digit-year pivot (default 50). */
  pivot?: number;
  /** `nomenclature.caseTypes`; defaults to the Madras HC table. */
  aliases?: Readonly<Record<string, readonly string[]>>;
  seatSuffixes?: readonly string[];
  /** `orderParser.directionPhrases`, for the `daily` fallback. */
  phrases?: readonly string[];
}

/** An order with nothing read: the result for empty or unrecognised input. */
export function emptyOrderHeader(): ParsedOrderHeader {
  return {
    caseTypeRaw: null,
    caseType: null,
    caseNumber: null,
    caseYear: null,
    orderDate: null,
    neutralCitation: null,
    neutralCitationRaw: null,
    anchor: null,
    confidence: 0,
    caseRefs: [],
    bench: null,
    judges: [],
    orderType: null,
  };
}

/** The header block ends at the title line; without one, the first 40 lines of page 1. */
const HEADER_FALLBACK_LINES = 40;
const TITLE_LINE =
  /^\s*(?:COMMON\s+)?(?:O\s*R\s*D\s*E\s*R|J\s*U\s*D\s*G\s*E?\s*M\s*E\s*N\s*T)\s*$/i;
const DATE_LABEL =
  /^\s*(?:DATED|DATE|Date\s+of\s+(?:order|judgment|decision)|Pronounced\s+on)\s*[:.-]?\s*(.+)$/i;
const BENCH_LINE = /^\s*(?:CORAM\s*[:.-]?\s*)?(THE\s+HON(?:OU?RABLE|'?BLE)\b.*)$/i;
const NOT_A_CASE_LINE =
  /petitioner|respondent|appellant|accused|complainant|prayer|\bvs\.?\b|versus|counsel|advocate|\bfor\s+the\b|MHC/i;
const MAX_CASE_LINE_LENGTH = 200;

interface HeaderLine {
  text: string;
  rowIndex: number;
}

const phraseRe = (phrase: string) =>
  new RegExp(
    String.raw`(?<![A-Za-z-])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`,
    'i',
  );

/** The header fields of a supplied order; see the file comment. Never throws. */
export function parseMadrasOrderHeader(
  input: ParserInput,
  options: OrderHeaderOptions = {},
): ParsedOrderHeader {
  const pages = documentPages(input);
  const firstPage = (pages[0] ?? '').split('\n');
  const titleAt = firstPage.findIndex((line) => TITLE_LINE.test(line));
  const headerEnd = titleAt === -1 ? Math.min(firstPage.length, HEADER_FALLBACK_LINES) : titleAt;
  const header: HeaderLine[] = firstPage
    .slice(0, headerEnd)
    .map((text, rowIndex) => ({ text: text.trim(), rowIndex }))
    .filter((line) => line.text !== '');

  let orderDate: string | null = null;
  let dateLine: HeaderLine | undefined;
  const judges: string[] = [];
  let benchLine: HeaderLine | undefined;
  const caseLines: HeaderLine[] = [];
  for (const line of header) {
    const label = DATE_LABEL.exec(line.text);
    if (label !== null) {
      const date = normaliseDate(label[1] ?? '', { pivot: options.pivot ?? 50 });
      if (date !== null && orderDate === null) {
        orderDate = date;
        dateLine = line;
      }
      continue;
    }
    const bench = BENCH_LINE.exec(line.text);
    if (bench !== null) {
      judges.push((bench[1] ?? '').trim());
      benchLine ??= line;
      continue;
    }
    if (line.text.length > MAX_CASE_LINE_LENGTH || NOT_A_CASE_LINE.test(line.text)) continue;
    if (parseCaseLine(line.text, caseLineOptions(options)).refs.length > 0) caseLines.push(line);
  }

  const refs: CaseRef[] =
    caseLines.length === 0
      ? []
      : parseCaseLine(caseLines.map((line) => line.text).join(' '), caseLineOptions(options)).refs;
  const [first] = refs;

  const citation = findNeutralCitation(pages.join('\n'));
  const anchorLine = caseLines[0] ?? benchLine ?? dateLine;
  const found = [refs.length > 0, orderDate !== null, judges.length > 0].filter(Boolean).length;
  if (anchorLine === undefined && citation === null) return emptyOrderHeader();

  return {
    caseTypeRaw: first?.caseTypeRaw ?? null,
    caseType: first?.caseTypeCode ?? null,
    ...(first?.seatSuffix === undefined ? {} : { seatSuffix: first.seatSuffix }),
    caseNumber: first?.number ?? null,
    caseYear: first?.year ?? null,
    orderDate,
    neutralCitation: citation?.normalised ?? null,
    neutralCitationRaw: citation?.raw ?? null,
    anchor:
      anchorLine === undefined
        ? null
        : { page: 1, quote: anchorLine.text, rowIndex: anchorLine.rowIndex },
    confidence: Math.round((found / 3) * 100) / 100,
    caseRefs: refs,
    bench: judges.length === 0 ? null : judges.join(' AND '),
    judges,
    orderType: orderTypeOf(
      input,
      pages,
      titleAt === -1 ? null : (firstPage[titleAt] ?? ''),
      headerEnd,
      options,
    ),
  };
}

function caseLineOptions(options: OrderHeaderOptions) {
  return {
    pivot: options.pivot ?? 50,
    aliases: options.aliases ?? MADRAS_HC_CASE_TYPE_ALIASES,
    seatSuffixes: options.seatSuffixes ?? ['MD'],
  };
}

function orderTypeOf(
  input: ParserInput,
  pages: readonly string[],
  title: string | null,
  headerEnd: number,
  options: OrderHeaderOptions,
): ParsedOrderHeader['orderType'] {
  // `J U D G M E N T`, `COMMON JUDGMENT`, `JUDGEMENT`: compared without spaces.
  const compactTitle = (title ?? '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace('judgement', 'judgment');
  const judgment = ORDER_TYPE_CUES.find((cue) => cue.type === 'judgment');
  if (judgment?.phrases.some((p) => compactTitle.includes(p.replace(/\s+/g, ''))) === true) {
    return 'judgment';
  }
  const [firstPage = '', ...rest] = pages;
  const body = maskEarlierOrderDates(
    [firstPage.split('\n').slice(headerEnd).join('\n'), ...rest].join('\n'),
  );
  for (const cue of ORDER_TYPE_CUES) {
    if (cue.type === 'judgment') continue;
    if (cue.phrases.some((p) => phraseRe(p).test(body))) return cue.type;
  }
  const hasCue =
    findMadrasDirectionCues(input, {
      ...(options.phrases === undefined ? {} : { phrases: options.phrases }),
      pivot: options.pivot ?? 50,
    }).length > 0;
  return title !== null || hasCue ? 'daily' : null;
}
