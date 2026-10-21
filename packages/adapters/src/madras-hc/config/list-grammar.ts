// Madras HC cause-list grammar (#395): regex sources the list parser (#396) reads lines with. The
// shape is assumed from parent #36 (research could not open an output list): a `COURT No. 12` hall
// block, bench lines, list-type markers, then numbered rows (`1.`, `12A.`, `5(a)`).

/** A hall heading; group 1 is the hall number. */
export const HALL_HEADING = '^COURT\\s+(?:HALL\\s+)?NO\\.?\\s*([0-9]+[A-Z]?)\\b';

/** A numbered row; group 1 is the item number (`1`, `12A`, `5(a)`), group 2 the rest. */
export const ROW_PATTERN = '^(\\d{1,4}[A-Z]?|\\d{1,4}\\([a-z]\\))(?:\\.|(?<=\\)))\\s*(.+)$';

/** Markers that name the list type, matched case-insensitively anywhere in a heading line. */
export const LIST_TYPE_MARKERS: readonly { pattern: string; key: string }[] = [
  { pattern: '\\bSUPPLEMENTARY\\b', key: 'supplementary' },
  { pattern: '\\bADVANCE\\b', key: 'advance' },
  { pattern: '\\bSPECIAL\\b', key: 'special' },
  { pattern: '\\bDAILY\\b', key: 'daily' },
];

/** A bench line: one or more judges, including Chief Justice phrasing. */
export const BENCH_LINE =
  "^(?:THE\\s+)?(?:HON'?BLE|HONOURABLE)\\b.*\\b(?:JUSTICE|CHIEF\\s+JUSTICE)\\b";

/** A line that looks like a hall heading even when OCR garbled it (`C0URT N0. l2`). */
export const HALL_PROBE = '^C[O0Q]URT\\b';

/** A line naming the list's date; the date itself is read by `normaliseDate`. */
export const LIST_DATE = '\\bLIST\\b';

/** A hall or list with nothing listed. */
export const NO_CASES = '^(?:[*-]+\\s*)?(?:NO\\s+CASES\\b|NIL\\b)';

/** Between petitioner and respondent, matched case-insensitively. */
export const PARTIES_SEPARATOR = '\\s(?:vs\\.?|v\\.|versus)\\s';

/** A continuation line that names advocates: a title or an enrolment number. */
export const ADVOCATE_LINE =
  '^(?:M\\/s\\.?|Mr\\.|Mrs\\.|Ms\\.|Dr\\.|Thiru|Tmt\\.?|Selvi|Sr\\.|Senior)\\s|\\b[A-Z]{1,3}\\/\\d{1,6}\\/(?:19|20)\\d{2}\\b';

/** A line that starts with a person's title: advocates, never parties (`M/s` firms can be either). */
export const ADVOCATE_PERSON = '^(?:Mr\\.|Mrs\\.|Ms\\.|Dr\\.|Thiru|Tmt\\.?|Selvi|Sr\\.|Senior)\\s';

/** A page number line (`Page 2 of 40`, `- 2 -`), skipped wherever it appears. */
export const PAGE_MARKER = '^(?:PAGE\\s+\\d+(?:\\s+OF\\s+\\d+)?|-\\s*\\d+\\s*-)$';
