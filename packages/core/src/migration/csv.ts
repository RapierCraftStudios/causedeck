// The portfolio file reader of the migration concierge (#685, part of #508). Pure: it reads CSV
// text, applies the column mapping the staff member chose and reports mapping issues per row as
// codes and row numbers, never the content of a row. No database, no clock (the caller passes
// today's IST date).

/** Most matters one migration run takes. */
export const MAX_MIGRATION_ROWS = 5000;

export const MIGRATION_FIELDS = [
  'title',
  'caseType',
  'caseNumber',
  'caseYear',
  'forumCode',
  'cnr',
  'parties',
  'stage',
  'nextDate',
] as const;
export type MigrationField = (typeof MIGRATION_FIELDS)[number];

/** Field -> the CSV header that holds it (matched case-insensitively); unmapped fields stay empty. */
export type ColumnMapping = Partial<Record<MigrationField, string>>;

export const MIGRATION_ISSUE_CODES = [
  'missing_title',
  'missing_case_type',
  'missing_forum',
  'unknown_forum',
  'bad_year',
  'bad_date',
  'past_date',
  'duplicate_in_file',
] as const;
export type MigrationIssueCode = (typeof MIGRATION_ISSUE_CODES)[number];

/** `past_date` is a warning (the date is dropped); every other issue keeps the row out. */
export const BLOCKING_ISSUES: ReadonlySet<MigrationIssueCode> = new Set(
  MIGRATION_ISSUE_CODES.filter((code) => code !== 'past_date'),
);

export interface MigrationRow {
  /** Zero-based position among the data rows of the file. */
  index: number;
  title: string;
  caseType: string | null;
  caseNumber: string | null;
  caseYear: number | null;
  forumCode: string | null;
  cnr: string | null;
  parties: string | null;
  stage: string | null;
  /** `YYYY-MM-DD`, a date on or after today; null when absent or dropped. */
  nextDate: string | null;
  issues: MigrationIssueCode[];
}

export interface ParsedMigrationFile {
  rows: MigrationRow[];
  /** Mapped headers the file does not have: a mapping issue of the whole file. */
  missingColumns: MigrationField[];
}

/** RFC 4180 records: quoted fields, doubled quotes, CRLF or LF; blank lines are skipped. */
export function readCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  const endRecord = () => {
    record.push(field);
    field = '';
    if (record.some((cell) => cell.trim() !== '')) records.push(record);
    record = [];
  };
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i);
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (source.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source.charAt(i + 1) === '\n') i++;
      endRecord();
    } else field += ch;
  }
  endRecord();
  return records;
}

const isRealDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** `YYYY-MM-DD` as is, or `DD/MM/YYYY` and `DD-MM-YYYY` (the Indian order). */
function normaliseDate(value: string): string | null {
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  const iso = dmy
    ? `${dmy[3] ?? ''}-${(dmy[2] ?? '').padStart(2, '0')}-${(dmy[1] ?? '').padStart(2, '0')}`
    : value;
  return isRealDate(iso) ? iso : null;
}

/** The identity of a proceeding within the file, for duplicate detection. */
function identityOf(row: MigrationRow): string | null {
  if (row.cnr !== null) return `cnr:${row.cnr}`;
  if (row.forumCode === null || row.caseType === null || row.caseNumber === null) return null;
  return [row.forumCode, row.caseType, row.caseNumber, row.caseYear ?? ''].join('|').toLowerCase();
}

/**
 * Read `text` with `mapping`. RangeError when the file holds more than `MAX_MIGRATION_ROWS` data
 * rows. A row the mapping cannot make a matter of carries blocking issue codes.
 */
export function parseMigrationCsv(
  text: string,
  mapping: ColumnMapping,
  today: string,
): ParsedMigrationFile {
  const [header, ...data] = readCsvRecords(text);
  if (data.length > MAX_MIGRATION_ROWS) {
    throw new RangeError(`A migration run holds at most ${String(MAX_MIGRATION_ROWS)} rows`);
  }
  const columns = new Map<string, number>();
  (header ?? []).forEach((name, at) => columns.set(name.trim().toLowerCase(), at));
  const position = new Map<MigrationField, number>();
  const missingColumns: MigrationField[] = [];
  for (const field of MIGRATION_FIELDS) {
    const name = mapping[field];
    if (name === undefined) continue;
    const at = columns.get(name.trim().toLowerCase());
    if (at === undefined) missingColumns.push(field);
    else position.set(field, at);
  }
  const seen = new Set<string>();
  const rows = data.map((cells, index): MigrationRow => {
    const cell = (field: MigrationField): string | null => {
      const at = position.get(field);
      const value = at === undefined ? '' : (cells[at] ?? '').trim();
      return value === '' ? null : value;
    };
    const issues: MigrationIssueCode[] = [];
    const title = cell('title');
    const yearText = cell('caseYear');
    const year = yearText === null ? null : Number(yearText);
    const validYear = year !== null && Number.isInteger(year) && year >= 1900 && year <= 2100;
    const dateText = cell('nextDate');
    const date = dateText === null ? null : normaliseDate(dateText);
    const row: MigrationRow = {
      index,
      title: title ?? '',
      caseType: cell('caseType'),
      caseNumber: cell('caseNumber'),
      caseYear: validYear ? year : null,
      forumCode: cell('forumCode'),
      cnr: cell('cnr')?.toUpperCase() ?? null,
      parties: cell('parties'),
      stage: cell('stage'),
      nextDate: date !== null && date >= today ? date : null,
      issues,
    };
    if (title === null) issues.push('missing_title');
    if (row.caseType === null) issues.push('missing_case_type');
    if (row.forumCode === null) issues.push('missing_forum');
    if (yearText !== null && !validYear) issues.push('bad_year');
    if (dateText !== null && date === null) issues.push('bad_date');
    if (date !== null && date < today) issues.push('past_date');
    const identity = identityOf(row);
    if (identity !== null) {
      if (seen.has(identity)) issues.push('duplicate_in_file');
      seen.add(identity);
    }
    return row;
  });
  return { rows, missingColumns };
}
