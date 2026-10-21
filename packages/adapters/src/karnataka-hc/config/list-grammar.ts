// Karnataka HC cause-list grammar (#404): regex sources the list parsers (#405) read lines with.
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
