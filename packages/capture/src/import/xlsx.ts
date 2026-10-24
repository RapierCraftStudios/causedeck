// .xlsx reader for the spreadsheet importer (#504): the first worksheet as rows of text. An xlsx is a
// zip of XML parts, read with fflate (no spreadsheet library). Formulas are read as their cached
// value; date cells come out as their serial number, which the date parser understands. Bounded:
// an oversized part or a zip that inflates past the cap is refused before it is decompressed.
import { unzipSync, type Unzipped } from 'fflate';

import { ImportReadError, MAX_IMPORT_ROWS } from './csv.ts';

/** Largest decompressed part read (a zip bomb guard). */
export const MAX_XLSX_PART_BYTES = 20 * 1024 * 1024;
const MAX_COLUMNS = 200;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const utf8 = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes);

/** Text of every `<t>` in a string item (rich text runs are joined). */
function textOf(xml: string): string {
  let out = '';
  for (const match of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += match[1] ?? '';
  return decodeXml(out);
}

function sharedStrings(parts: Unzipped): string[] {
  const file = parts['xl/sharedStrings.xml'];
  if (file === undefined) return [];
  return [...utf8(file).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) =>
    textOf(m[1] ?? ''),
  );
}

/** 0-based column of a reference such as `AB12`. */
function columnOf(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function sheetName(parts: Unzipped): string | null {
  const names = Object.keys(parts)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]));
  return names[0] ?? null;
}

/** The first worksheet of an `.xlsx` as rows of text (empty cells are `''`), header included. */
export function readXlsx(bytes: Uint8Array): string[][] {
  let parts: Unzipped;
  try {
    parts = unzipSync(bytes, {
      filter: (file) => {
        if (file.originalSize > MAX_XLSX_PART_BYTES) {
          throw new ImportReadError('too_large', 'The workbook is too large');
        }
        return (
          file.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(file.name)
        );
      },
    });
  } catch (error) {
    if (error instanceof ImportReadError) throw error;
    throw new ImportReadError('not_xlsx', 'Not an .xlsx workbook');
  }
  const name = sheetName(parts);
  const sheet = name === null ? undefined : parts[name];
  if (sheet === undefined) throw new ImportReadError('not_xlsx', 'The workbook has no worksheet');
  const strings = sharedStrings(parts);
  const rows: string[][] = [];
  for (const rowMatch of utf8(sheet).matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cell of (rowMatch[1] ?? '').matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? '';
      const body = cell[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
      const index = ref === undefined ? row.length : columnOf(ref);
      if (index < 0 || index >= MAX_COLUMNS) continue;
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 'inlineStr') text = textOf(body);
      else if (type === 's') text = strings[Number(value)] ?? '';
      else if (value !== undefined) text = decodeXml(value);
      while (row.length < index) row.push('');
      row[index] = text;
    }
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    if (rows.length > MAX_IMPORT_ROWS + 1) {
      throw new ImportReadError('too_many_rows', `More than ${String(MAX_IMPORT_ROWS)} rows`);
    }
  }
  return rows;
}
