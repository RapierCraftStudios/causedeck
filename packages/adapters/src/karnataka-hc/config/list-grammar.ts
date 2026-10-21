// Karnataka HC cause-list grammar (#404, #405): regex sources the list parsers read lines with.
// The shape is assumed (research/raw/09 §1.2: output lists were not readable): a `COURT HALL NO. 1`
// block, a `LIST NO. 2` marker, list-type words in headings, then numbered rows.

/** A hall heading; group 1 is the hall number. */
export const KARNATAKA_HC_HALL_HEADING = '^COURT\\s+(?:HALL\\s+)?NO\\.?\\s*([0-9]+[A-Z]?)\\b';

/** A numbered row; group 1 is the serial number, group 2 the rest. */
export const KARNATAKA_HC_ROW_PATTERN = '^(\\d{1,4}[A-Z]?)(?:\\.|\\))?\\s+(.+)$';

/** A list marker; group 1 is the list number. */
export const KARNATAKA_HC_LIST_NO = '\\bLIST\\s+NO\\.?\\s*([0-9]+[A-Z]?)\\b';

/** Markers that name the list type, matched case-insensitively anywhere in a heading line. */
export const KARNATAKA_HC_LIST_TYPE_MARKERS: readonly { pattern: string; key: string }[] = [
  { pattern: '\\bSUPPLEMENTARY\\b', key: 'supplementary' },
  { pattern: '\\bADVANCE\\b', key: 'advance' },
  { pattern: '\\bSPECIAL\\b', key: 'special' },
  { pattern: '\\bDAILY\\b', key: 'daily' },
  { pattern: '\\bENTIRE\\b', key: 'entire' },
];

/** A judge line: `HON'BLE MR. JUSTICE ...`, `THE HONOURABLE ...`. */
export const KARNATAKA_HC_BENCH_LINE =
  "^(?:THE\\s+)?(?:HON['’`]?\\s*BLE|HONOURABLE)\\b|\\bJUSTICE\\b";

/** A line stating the list's date (`CAUSE LIST FOR 22-10-2026`, `Date: 22.10.2026`). */
export const KARNATAKA_HC_LIST_DATE =
  '\\b(?:CAUSE\\s*LIST|LIST)\\s+(?:FOR|DATED|OF|ON)\\b|^DATED?\\s*:';

/** The publication stamp of the court's list page; its date and time give `publishedAt`. */
export const KARNATAKA_HC_PUBLISHED_STAMP = '\\bLAST\\s+CAUSE\\s*LIST\\s+UPDATED\\b';

/** A time of day after the stamp's date; groups: hours, minutes, seconds, AM/PM. */
export const KARNATAKA_HC_STAMP_TIME =
  '\\b(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*([AP])?\\.?\\s*(?:M\\b\\.?)?';

/** A printed "nothing listed" marker: the list is empty, not unreadable. */
export const KARNATAKA_HC_NO_CASES = '\\bNO\\s+(?:CASES?|MATTERS?)\\b|^NIL\\.?$';

/** The title of a cause list. */
export const KARNATAKA_HC_LIST_TITLE = '\\bCAUSE\\s*LIST\\b';

/** `Page 3 of 40` and similar page furniture. */
export const KARNATAKA_HC_PAGE_MARKER = '^PAGE\\s+\\d+(?:\\s*(?:OF|/)\\s*\\d+)?$';
