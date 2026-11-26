// Row mapping of the HF dataset `overthelex/indian-court-decisions` (#1171): one Parquet row to the
// fields a `judgment` row takes, plus the court and year filters of an import slice. The dataset's
// `year` and `decision_date` sometimes disagree; a plausible decision date wins, otherwise the year
// column stands and the date is dropped. Pure functions, no I/O.

/** The two configs of the dataset: Supreme Court and the 25 High Courts. */
export const HF_CONFIGS = { sc: 'supreme_court', hc: 'high_courts' } as const;
export type HfDataset = keyof typeof HF_CONFIGS;
export type HfConfig = (typeof HF_CONFIGS)[HfDataset];

/** The columns the importer reads (projection); `petitioner`/`respondent` exist for SC only. */
export const HF_COLUMNS = [
  'cnr',
  'court_code',
  'court_name',
  'bench',
  'year',
  'decision_date',
  'title',
  'judge',
  'petitioner',
  'respondent',
  'case_type',
  'full_text',
] as const;
/** The small columns a row group is filtered on before its texts are read. */
export const HF_FILTER_COLUMNS = ['court_code', 'year', 'decision_date'] as const;

/** One raw row as hyparquet decodes it: strings, numbers, bigints, dates or null. */
export type HfRawRow = Partial<Record<(typeof HF_COLUMNS)[number], unknown>>;

export interface HfMappedRow {
  cnr: string | null;
  courtCode: string | null;
  courtName: string | null;
  /** The reconciled decision year; null when neither column gives a plausible one. */
  year: number | null;
  /** `YYYY-MM-DD`, null when absent, unparsable or contradicting the year beyond repair. */
  judgmentDate: string | null;
  /** Judges named for the decision. */
  bench: string[];
  title: string | null;
  petitioner: string | null;
  respondent: string | null;
  caseType: string | null;
  text: string;
}

export interface HfSliceFilter {
  /** Matches `court_code` exactly (case-insensitive). */
  court?: string | undefined;
  yearFrom?: number | undefined;
  yearTo?: number | undefined;
}

const MIN_YEAR = 1947;

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return null;
};

const plausibleYear = (y: number, now: Date): boolean =>
  Number.isInteger(y) && y >= MIN_YEAR && y <= now.getUTCFullYear() + 1;

/** `YYYY-MM-DD` of a date value: ISO strings, `DD-MM-YYYY`/`DD/MM/YYYY`, Date or epoch days/ms. */
export function parseDecisionDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = str(v);
  if (s === null) return null;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (iso !== null) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy !== null) [y, m, d] = [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return date.toISOString().slice(0, 10);
}

/** The year and date to store: a plausible decision date wins over a disagreeing `year` column. */
export function reconcileYear(
  yearValue: unknown,
  dateValue: unknown,
  now: Date = new Date(),
): { year: number | null; judgmentDate: string | null } {
  const yearNum = Number(str(yearValue) ?? NaN);
  const year = plausibleYear(yearNum, now) ? yearNum : null;
  const date = parseDecisionDate(dateValue);
  const dateYear = date === null ? NaN : Number(date.slice(0, 4));
  if (date !== null && plausibleYear(dateYear, now)) return { year: dateYear, judgmentDate: date };
  return { year, judgmentDate: null };
}

/** Judge names from the `judge` column: comma, semicolon, ampersand or "and" separated. */
export function splitJudges(v: unknown): string[] {
  const s = str(v);
  if (s === null) return [];
  return s
    .split(/\s*(?:[,;&]|\band\b)\s*/i)
    .map((n) =>
      n.replace(/^(?:(?:hon'?ble|the|chief|justice|mr\.?|mrs\.?|ms\.?|dr\.?)\s+)+/i, '').trim(),
    )
    .filter((n) => /\p{L}{2,}/u.test(n));
}

/** Map one decoded row; null when it has no text. */
export function mapHfRow(raw: HfRawRow, now: Date = new Date()): HfMappedRow | null {
  const text = typeof raw.full_text === 'string' ? raw.full_text : null;
  if (text === null || text.trim() === '') return null;
  const { year, judgmentDate } = reconcileYear(raw.year, raw.decision_date, now);
  return {
    cnr: str(raw.cnr)?.toUpperCase() ?? null,
    courtCode: str(raw.court_code),
    courtName: str(raw.court_name),
    year,
    judgmentDate,
    bench: splitJudges(raw.judge),
    title: str(raw.title),
    petitioner: str(raw.petitioner),
    respondent: str(raw.respondent),
    caseType: str(raw.case_type),
    text,
  };
}

/** Whether a row (only its filter columns are needed) is inside the slice. */
export function inSlice(raw: HfRawRow, filter: HfSliceFilter, now: Date = new Date()): boolean {
  if (filter.court !== undefined) {
    const code = str(raw.court_code);
    if (code === null || code.toLowerCase() !== filter.court.toLowerCase()) return false;
  }
  if (filter.yearFrom !== undefined || filter.yearTo !== undefined) {
    const { year } = reconcileYear(raw.year, raw.decision_date, now);
    if (year === null) return false;
    if (filter.yearFrom !== undefined && year < filter.yearFrom) return false;
    if (filter.yearTo !== undefined && year > filter.yearTo) return false;
  }
  return true;
}
