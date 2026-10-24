// CSV for the institution portfolio (#663, part 3 of #498): a small RFC 4180 reader for the import
// (BOM, CRLF, quoted fields) and the writer the export uses, which neutralises spreadsheet formulas.
import { schema } from '@causedeck/db';

import { invalid } from '../shared/errors.ts';

/** Data rows (not counting the header) one import may carry. */
export const MAX_PORTFOLIO_IMPORT_ROWS = 1000;

const CNR = new RegExp(schema.CNR_PATTERN);

export interface PortfolioCsvRow {
  /** 1-based line of the record in the file (the header is line 1). */
  line: number;
  cnr: string | null;
  caseNumber: string | null;
  sourceId: string | null;
}

export interface PortfolioCsvError {
  line: number;
  message: string;
}

export interface ParsedPortfolioCsv {
  rows: PortfolioCsvRow[];
  errors: PortfolioCsvError[];
}

/** Split CSV text into records of fields. Quoted fields may hold commas, quotes ("") and newlines. */
function records(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  const endRecord = () => {
    record.push(field);
    field = '';
    if (record.length > 1 || record[0] !== '') out.push(record);
    record = [];
  };
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charAt(i);
    if (quoted) {
      if (ch === '"' && input.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input.charAt(i + 1) === '\n') i += 1;
      endRecord();
    } else field += ch;
  }
  if (quoted) throw invalid('The CSV has an unclosed quote');
  endRecord();
  return out;
}

/**
 * Parse an import file: a header naming `cnr` and/or `case_number` (and optionally `source`), then
 * one case per row. A bad row is reported, not thrown; more than 1,000 rows or no usable header is
 * a validation error. A CNR repeated in the file is kept once.
 */
export function parsePortfolioCsv(text: string): ParsedPortfolioCsv {
  const all = records(text);
  const header = all[0]?.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_'),
  );
  if (header === undefined) throw invalid('The CSV is empty');
  const col = (name: string) => header.indexOf(name);
  const cnrAt = col('cnr');
  const numberAt = col('case_number');
  const sourceAt = col('source');
  if (cnrAt < 0 && numberAt < 0) throw invalid('The CSV needs a cnr or case_number column');
  if (all.length - 1 > MAX_PORTFOLIO_IMPORT_ROWS) {
    throw invalid(`An import holds at most ${String(MAX_PORTFOLIO_IMPORT_ROWS)} rows`);
  }
  const rows: PortfolioCsvRow[] = [];
  const errors: PortfolioCsvError[] = [];
  const seen = new Set<string>();
  all.slice(1).forEach((fields, index) => {
    const line = index + 2;
    const cell = (at: number) => (at < 0 ? '' : (fields[at] ?? '').trim());
    const cnr = cell(cnrAt).toUpperCase() || null;
    const caseNumber = cell(numberAt).replace(/\s+/g, ' ') || null;
    if (cnr === null && caseNumber === null) {
      errors.push({ line, message: 'Enter a CNR or a case number' });
    } else if (cnr !== null && !CNR.test(cnr)) {
      errors.push({ line, message: 'Not a valid CNR' });
    } else if (caseNumber !== null && caseNumber.length > 100) {
      errors.push({ line, message: 'Case number is too long' });
    } else if (cnr !== null && seen.has(cnr)) {
      errors.push({ line, message: 'Repeats an earlier CNR in the file' });
    } else {
      if (cnr !== null) seen.add(cnr);
      rows.push({ line, cnr, caseNumber, sourceId: cell(sourceAt) || null });
    }
  });
  return { rows, errors };
}

/** A cell that a spreadsheet would run as a formula gets a leading apostrophe. */
function safe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Serialise rows of cells as CSV (CRLF line ends, quoting where needed, formulas neutralised). */
export function toCsv(table: readonly (readonly (string | null)[])[]): string {
  return table
    .map((row) =>
      row
        .map((cell) => {
          const text = safe(cell ?? '');
          return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(','),
    )
    .join('\r\n')
    .concat('\r\n');
}
