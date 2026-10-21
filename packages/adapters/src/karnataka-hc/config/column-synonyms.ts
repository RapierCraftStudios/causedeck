// Karnataka HC cause-list columns (#404): assumed table header names, upper-case, mapped to the row
// field they fill. Real column names are unverified (ADR 0018); the parsers (#405) match a header
// cell against these after trimming and collapsing spaces. A list without advocate columns is still
// read (`advocates: []` with a diagnostic).

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
    parties: ['PARTY NAME', 'PARTIES', 'PETITIONER VS RESPONDENT', 'PARTY DETAILS'],
    petitionerAdvocate: ['PETITIONER ADVOCATE', 'ADVOCATE FOR PETITIONER', 'PET. ADV.'],
    respondentAdvocate: ['RESPONDENT ADVOCATE', 'ADVOCATE FOR RESPONDENT', 'RES. ADV.'],
    remarks: ['REMARKS', 'OFFICE OBJECTIONS', 'OBJECTIONS'],
  };

/** The column a header cell names, or null. */
export function karnatakaHcColumnOf(header: string): KarnatakaHcColumn | null {
  const cell = header.trim().replace(/\s+/g, ' ').toUpperCase();
  for (const column of KARNATAKA_HC_COLUMNS) {
    if (KARNATAKA_HC_COLUMN_SYNONYMS[column].includes(cell)) return column;
  }
  return null;
}
