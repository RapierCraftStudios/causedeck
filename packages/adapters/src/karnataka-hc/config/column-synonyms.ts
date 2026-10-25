// Karnataka HC cause-list columns (#404, #405): assumed table header names, mapped to the row field
// they fill. Real column names are unverified (ADR 0019). A header cell matches a synonym on their
// normal form: upper case with dots and whitespace removed, so `Sl. No.`, `Sl.No` and `SL NO` are one
// name. A list without advocate columns is still read (`advocates: []`).

export const KARNATAKA_HC_COLUMNS = [
  'itemNo',
  'caseNo',
  'parties',
  'petitionerAdvocate',
  'respondentAdvocate',
  'remarks',
] as const;
export type KarnatakaHcColumn = (typeof KARNATAKA_HC_COLUMNS)[number];

export const KARNATAKA_HC_COLUMN_SYNONYMS: Readonly<Record<KarnatakaHcColumn, readonly string[]>> =
  {
    itemNo: ['SL NO', 'SL.NO.', 'S.NO.', 'SR NO', 'ITEM NO'],
    caseNo: ['CASE NO', 'CASE NUMBER', 'CASE NO.'],
    parties: [
      'PARTY NAME',
      'PARTIES',
      'PETITIONER / RESPONDENT',
      'PETITIONER VS RESPONDENT',
      'PARTY DETAILS',
    ],
    petitionerAdvocate: ['PETITIONER ADVOCATE', 'ADVOCATE FOR PETITIONER', 'PET. ADV.'],
    respondentAdvocate: ['RESPONDENT ADVOCATE', 'ADVOCATE FOR RESPONDENT', 'RES. ADV.'],
    remarks: ['REMARKS', 'OFFICE OBJECTIONS', 'OBJECTIONS'],
  };

/** The form header cells and synonyms are compared in. */
export const karnatakaHcHeaderKey = (text: string): string =>
  text.toUpperCase().replace(/[.\s]+/g, '');

const BY_KEY = new Map<string, KarnatakaHcColumn>(
  KARNATAKA_HC_COLUMNS.flatMap((column) =>
    KARNATAKA_HC_COLUMN_SYNONYMS[column].map(
      (name) => [karnatakaHcHeaderKey(name), column] as const,
    ),
  ),
);

/** The column a header cell names, or null. */
export function karnatakaHcColumnOf(header: string): KarnatakaHcColumn | null {
  const key = karnatakaHcHeaderKey(header);
  return key === '' ? null : (BY_KEY.get(key) ?? null);
}
