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
