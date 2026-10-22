// Karnataka HC order header (#406, part 3 of #37). An order or judgment opens with a preamble before
// the parties (`BETWEEN:`) and its `ORDER` / `JUDGMENT` title line:
//
//   IN THE HIGH COURT OF KARNATAKA AT BENGALURU
//   DATED THIS THE 14TH DAY OF NOVEMBER, 2026                    -> orderDate (a header label only)
//   BEFORE | PRESENT                                             -> bench, judges[]
//   THE HON'BLE MR JUSTICE A. FICTIONAL
//   WRIT PETITION NO. 12345 OF 2026 (GM-RES)                     -> caseRefs (case-line grammar)
//   2026:KHC:1234 | 2026:KHC-D:567 | 2026:KHC:89-DB              -> neutralCitation, neutralCitationRaw
//
// The order date is read only from a header label (`DATED THIS THE ...`, `DATED:`), so a reference to
// an earlier or impugned order in the body (`impugned order dated 03.03.2019`) is never the order
// date. Case lines are read before `BETWEEN`, so party addresses are not mistaken for cases.
// `orderType` is `judgment` from the title line, else `final` or `interim` from the body's cues,
// else `daily` for an order with a title or a direction cue. `authenticityFlag` is reserved for a
// later e-judgment authenticity check and always null. Pure and total: it never throws.
import { documentPages } from '../madras-hc/direction-cues.ts';
import { normaliseDate } from '../normalise/date.ts';
import type { CaseRef, ParsedOrderHeader, ParserInput } from '../types.ts';

import { parseKarnatakaCaseLine } from './case-line.ts';
import { KARNATAKA_HC_CASE_TYPE_ALIASES } from './config/case-types.ts';
import { KARNATAKA_HC_ORDER_TYPE_CUES } from './config/order-cues.ts';
import { findKarnatakaDirectionCues, maskKarnatakaEarlierOrderDates } from './direction-cues.ts';
import { findKarnatakaNeutralCitation } from './neutral-citation.ts';

export interface KarnatakaOrderHeaderOptions {
  /** Two-digit-year pivot (default 50). */
  pivot?: number;
  /** `nomenclature.caseTypes`; defaults to the Karnataka HC table. */
  aliases?: Readonly<Record<string, readonly string[]>>;
  /** `orderParser.directionPhrases`, for the `daily` fallback. */
  phrases?: readonly string[];
}

/** An order with nothing read: the result for empty or unrecognised input. */
export function emptyKarnatakaOrderHeader(): ParsedOrderHeader {
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
    authenticityFlag: null,
  };
}

/** The header block ends at the title line or `BETWEEN`; without either, the first 40 lines. */
const HEADER_FALLBACK_LINES = 40;
const TITLE_LINE =
  /^\s*(?:COMMON\s+)?(?:O\s*R\s*D\s*E\s*R|J\s*U\s*D\s*G\s*E?\s*M\s*E\s*N\s*T)\s*$/i;
const PARTIES_LINE = /^\s*BETWEEN\s*[:.-]?\s*$/i;
const DATE_LABEL =
  /^\s*(?:DATED|DATE\s+OF\s+(?:ORDER|JUDGMENT|DECISION)|PRONOUNCED\s+ON)\s*(?:THIS\s+)?(?:THE\s+)?[:.-]?\s*(.+)$/i;
const BENCH_LINE =
  /^\s*(?:(?:BEFORE|PRESENT|CORAM)\s*[:.-]?\s*)?(THE\s+HON(?:OU?RABLE|['’]?\s*BLE)\b.*)$/i;
const NOT_A_CASE_LINE =
  /petitioner|respondent|appellant|accused|complainant|prayer|\bvs\.?\b|versus|counsel|advocate|\bfor\s+the\b|high\s+court|KHC/i;
/** Separators between the cases of a common order: `C/W`, `AND`, commas. */
const CASE_SEPARATOR = /\s*(?:\bC\s*\/\s*W\b|\bAND\b|,|&)\s*/i;
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

/** The header fields of a supplied Karnataka HC order; see the file comment. Never throws. */
export function parseKarnatakaOrderHeader(
  input: ParserInput,
  options: KarnatakaOrderHeaderOptions = {},
): ParsedOrderHeader {
  const pivot = options.pivot ?? 50;
  const pages = documentPages(input);
  const firstPage = (pages[0] ?? '').split('\n');
  const titleAt = firstPage.findIndex((line) => TITLE_LINE.test(line));
  const partiesAt = firstPage.findIndex((line) => PARTIES_LINE.test(line));
  const ends = [titleAt, partiesAt].filter((at) => at !== -1);
  const headerEnd =
    ends.length === 0 ? Math.min(firstPage.length, HEADER_FALLBACK_LINES) : Math.min(...ends);
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
      // `14TH DAY OF NOVEMBER`: the date normaliser reads ordinal suffixes in lower case.
      const date = normaliseDate((label[1] ?? '').toLowerCase(), { pivot });
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
    if (caseRefsOf(line.text, options).length > 0) caseLines.push(line);
  }

  const refs = caseRefsOf(caseLines.map((line) => line.text).join(' , '), options);
  const [first] = refs;

  const citation = findKarnatakaNeutralCitation(pages.join('\n'));
  const anchorLine = caseLines[0] ?? benchLine ?? dateLine;
  const found = [refs.length > 0, orderDate !== null, judges.length > 0].filter(Boolean).length;
  if (anchorLine === undefined && citation === null) return emptyKarnatakaOrderHeader();

  return {
    caseTypeRaw: first?.caseTypeRaw ?? null,
    caseType: first?.caseTypeCode ?? null,
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
      titleAt === -1 ? headerEnd : titleAt + 1,
      options,
    ),
    authenticityFlag: null,
  };
}

/** The references on a header line, one common-order segment (`C/W`, `AND`) at a time. */
function caseRefsOf(text: string, options: KarnatakaOrderHeaderOptions): CaseRef[] {
  const lineOptions = {
    pivot: options.pivot ?? 50,
    aliases: options.aliases ?? KARNATAKA_HC_CASE_TYPE_ALIASES,
  };
  return text
    .split(CASE_SEPARATOR)
    .filter((segment) => segment.trim() !== '')
    .flatMap((segment) => parseKarnatakaCaseLine(segment, lineOptions).refs);
}

function orderTypeOf(
  input: ParserInput,
  pages: readonly string[],
  title: string | null,
  bodyStart: number,
  options: KarnatakaOrderHeaderOptions,
): ParsedOrderHeader['orderType'] {
  // `J U D G M E N T`, `COMMON JUDGMENT`, `JUDGEMENT`: compared without spaces.
  const compactTitle = (title ?? '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace('judgement', 'judgment');
  const judgment = KARNATAKA_HC_ORDER_TYPE_CUES.find((cue) => cue.type === 'judgment');
  if (judgment?.phrases.some((p) => compactTitle.includes(p.replace(/\s+/g, ''))) === true) {
    return 'judgment';
  }
  const [firstPage = '', ...rest] = pages;
  const body = maskKarnatakaEarlierOrderDates(
    [firstPage.split('\n').slice(bodyStart).join('\n'), ...rest].join('\n'),
  );
  for (const cue of KARNATAKA_HC_ORDER_TYPE_CUES) {
    if (cue.type === 'judgment') continue;
    if (cue.phrases.some((p) => phraseRe(p).test(body))) return cue.type;
  }
  const hasCue =
    findKarnatakaDirectionCues(input, {
      ...(options.phrases === undefined ? {} : { phrases: options.phrases }),
      pivot: options.pivot ?? 50,
    }).length > 0;
  return title !== null || hasCue ? 'daily' : null;
}
