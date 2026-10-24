// DRT and DRAT cause list (#662): a saved "Cause List" page. A single-cell row `Court: DRT-1
// Bengaluru - Presiding Officer` opens a hall; the table's header row names `Sl No`, `Case No`,
// `Parties`, `Advocate` and `Purpose`. Every row is anchored on its verbatim case-number cell.
// Pure and total.
import type { StageMapEntry } from '../config/schema.ts';
import { normaliseCaseNumber, parseCaseReference } from '../normalise/case-number.ts';
import { normaliseDate } from '../normalise/date.ts';
import { matchKey } from '../normalise/match-key.ts';
import { normaliseStage } from '../normalise/stage.ts';
import { collapse, labelOf, readHtmlTables, type Row } from '../status/html.ts';
import type { CauseListHall, ParsedCauseList, ParsedListRow, UnparsedRow } from '../types.ts';

const HALL = /^(?:court|bench)\s*(?:no\.?|number|hall)?\s*[:.-]?\s*(.+)$/i;
const NUMERIC_DATE = '\\d{1,2}\\s*[./-]\\s*\\d{1,2}\\s*[./-]\\s*\\d{2,4}';
const WORDED_DATE = '\\d{1,2}(?:st|nd|rd|th)?\\s+[A-Za-z]{3,9}\\.?,?\\s+\\d{4}';
const LIST_DATE = new RegExp(
  `cause\\s*list\\s*(?:for|date|dated|on)?\\s*:?\\s*(${NUMERIC_DATE}|${WORDED_DATE})`,
  'i',
);

const COLUMNS = {
  serial: /^(sl\.? ?no\.?|sr\.? ?no\.?|serial number|s\.? ?no\.?)$/,
  caseNumber: /^(case number|case no\.?|o\.?a\.? no\.?)$/,
  parties: /^(parties|party name|name of parties|applicant vs defendant)$/,
  purpose: /^(purpose|stage|purpose of hearing)$/,
};

export interface DrtCauseListOptions {
  adapterId: string;
  adapterVersion: string;
  forumCode: string;
  stageMap: readonly StageMapEntry[];
}

export function parseDrtCauseList(html: string, options: DrtCauseListOptions): ParsedCauseList {
  const { tables, pageText } = readHtmlTables(html);
  const rows: ParsedListRow[] = [];
  const unparsedRows: UnparsedRow[] = [];
  const halls: CauseListHall[] = [];
  const hallsSeen: string[] = [];
  const unmappedHeadings: string[] = [];
  let recognised = false;

  for (const table of tables) {
    const headerIndex = table.findIndex((row) =>
      row.some((cell) => COLUMNS.caseNumber.test(labelOf(cell.text))),
    );
    if (headerIndex < 0) continue;
    recognised = true;
    const header = table[headerIndex] as Row;
    const at = (pattern: RegExp) => header.findIndex((cell) => pattern.test(labelOf(cell.text)));
    const serial = at(COLUMNS.serial);
    const caseCol = at(COLUMNS.caseNumber);
    const partyCol = at(COLUMNS.parties);
    const purposeCol = at(COLUMNS.purpose);
    let hall: { hallNo: string; bench?: string; rows: ParsedListRow[] } | null = null;

    for (const row of table.slice(headerIndex + 1)) {
      const first = row[0]?.text ?? '';
      const heading = row.length === 1 ? HALL.exec(first) : null;
      if (heading !== null) {
        const bench = collapse(heading[1] ?? '');
        hall = { hallNo: String(halls.length + 1), bench, rows: [] };
        halls.push({ hallNo: hall.hallNo, bench, lists: [{ rows: hall.rows }] });
        hallsSeen.push(hall.hallNo);
        continue;
      }
      const quote = row[caseCol]?.text ?? '';
      if (quote === '') continue;
      const anchor = { page: 1, quote, rowIndex: rows.length + unparsedRows.length };
      const reference = parseCaseReference(quote);
      if (reference === null || normaliseCaseNumber(quote) === null) {
        unparsedRows.push({ anchor, text: quote, reason: 'no case number' });
        continue;
      }
      const parties = partyCol < 0 ? '' : (row[partyCol]?.text ?? '');
      const itemNo = serial < 0 ? '' : (row[serial]?.text ?? '');
      const purpose = purposeCol < 0 ? '' : (row[purposeCol]?.text ?? '');
      const stage = purpose === '' ? null : normaliseStage(purpose, options.stageMap);
      if (stage !== null && stage.stageNorm === null && !unmappedHeadings.includes(purpose))
        unmappedHeadings.push(purpose);
      const parsed: ParsedListRow = {
        anchor,
        confidence: 0.9,
        ...(hall === null ? {} : { hallNo: hall.hallNo }),
        ...(itemNo === '' ? {} : { itemNo }),
        caseTypeRaw: reference.caseTypeRaw.replace(/[\s/-]+$/, ''),
        caseType: reference.caseType,
        caseNumber: reference.number,
        caseYear: reference.year,
        matchKey: matchKey({
          caseType: reference.caseType,
          caseNumber: reference.number,
          caseYear: reference.year,
        }),
        ...(parties === '' ? {} : { parties }),
        ...(hall?.bench === undefined ? {} : { bench: hall.bench }),
        stageRaw: stage === null ? null : purpose,
        stageNorm: stage?.stageNorm ?? null,
      };
      rows.push(parsed);
      hall?.rows.push(parsed);
    }
  }

  const dateMatch = LIST_DATE.exec(pageText);
  const listDate = dateMatch === null ? null : normaliseDate(dateMatch[1] ?? '');
  return {
    adapterId: options.adapterId,
    adapterVersion: options.adapterVersion,
    forumCode: options.forumCode,
    listDate,
    rows,
    diagnostics: {
      unmappedHeadings,
      unknownCaseTypes: [
        ...new Set(rows.filter((r) => r.caseType === null).map((r) => r.caseTypeRaw)),
      ],
      rowsSkippedNoAnchor: 0,
      hallsSeen,
      hallsUnreadable: [],
    },
    halls,
    unparsedRows,
    status: !recognised
      ? 'not_a_cause_list'
      : rows.length + unparsedRows.length === 0
        ? 'empty'
        : 'ok',
    source: 'html',
    ...(dateMatch === null || listDate === null
      ? {}
      : { listDateAnchor: { page: 1, quote: collapse(dateMatch[0]), rowIndex: 0 } }),
  };
}
