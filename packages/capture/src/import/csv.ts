// CSV reader for the spreadsheet importer (#504): RFC 4180 with a BOM, CRLF, quoted fields that hold
// delimiters, quotes ("") and newlines, and a delimiter sniffed from the header line (Excel in India
// and Europe exports `;` or tab). Pure; the text is never logged.

/** Data rows one sheet import may carry. */
export const MAX_IMPORT_ROWS = 5000;

export class ImportReadError extends Error {
  readonly code: 'not_xlsx' | 'too_large' | 'too_many_rows' | 'empty';
  constructor(code: ImportReadError['code'], message: string) {
    super(message);
    this.name = 'ImportReadError';
    this.code = code;
  }
}

const DELIMITERS = [',', ';', '\t'] as const;

/** The delimiter used most often outside quotes on the first line (comma on a tie). */
function sniffDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best: string = ',';
  for (const d of DELIMITERS) if ((counts.get(d) ?? 0) > (counts.get(best) ?? 0)) best = d;
  return best;
}

/** Records of fields, header included; blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = sniffDelimiter(input);
  const out: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  const endRecord = () => {
    record.push(field);
    field = '';
    if (record.length > 1 || (record[0] ?? '').trim() !== '') out.push(record);
    record = [];
    if (out.length > MAX_IMPORT_ROWS + 1) {
      throw new ImportReadError('too_many_rows', `More than ${String(MAX_IMPORT_ROWS)} rows`);
    }
  };
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charAt(i);
    if (quoted) {
      if (ch === '"' && input.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input.charAt(i + 1) === '\n') i += 1;
      endRecord();
    } else field += ch;
  }
  if (field !== '' || record.length > 0) endRecord();
  return out;
}
