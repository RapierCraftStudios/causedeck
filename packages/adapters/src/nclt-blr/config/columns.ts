// NCLT Bengaluru cause-list columns (#38, ADR 0019). The ten columns of the 2023 Bengaluru bench
// list (research/raw/09 §2.2), keyed canonically, with the header spellings that name them. Only
// the first spelling of each is verified; the rest are assumptions to retire with real lists
// (#119). Header text is compared case-, space- and punctuation-insensitively, so `Sl.No.` and
// `SL NO` both match `Sl. No.`. These feed `NCLT_CONFIG.table.columns`, the versioned config.

/** Canonical column keys, in the order the 2023 list prints them. */
export const NCLT_COLUMN_KEYS = [
  'slNo',
  'cpNo',
  'caIaNo',
  'purpose',
  'section',
  'parties',
  'counselPetitioner',
  'counselRespondent',
  'resolutionProfessional',
  'remarks',
] as const;
export type NcltColumnKey = (typeof NCLT_COLUMN_KEYS)[number];

export const NCLT_COLUMNS: Readonly<Record<NcltColumnKey, readonly string[]>> = {
  slNo: ['Sl. No.', 'S. No.', 'Sr. No.', 'Serial No.', 'Item No.'],
  cpNo: ['CP No.', 'C.P. No.', 'Company Petition No.', 'Case No.', 'TCP/CP No.'],
  caIaNo: ['CA/IA No.', 'IA/CA No.', 'CA No./IA No.', 'IA No.', 'CA No.', 'IA/CA/MA No.'],
  purpose: ['Purpose', 'Stage', 'Purpose of Hearing'],
  section: ['Section', 'Sec.', 'Section of Law'],
  parties: ['Name of Parties', 'Parties', 'Name of the Parties', 'Petitioner Vs Respondent'],
  counselPetitioner: [
    'Counsel for Petitioner/Applicant',
    'Counsel for Petitioner',
    'Counsel for Applicant',
    'Counsel for the Petitioner/Applicant',
    'Advocate for Petitioner',
  ],
  counselRespondent: [
    'Counsel for Respondent',
    'Counsel for the Respondent',
    'Counsel for Respondents',
    'Advocate for Respondent',
  ],
  resolutionProfessional: [
    'IRP/RP/Liquidator/MP',
    'IRP/RP/Liquidator',
    'IRP/RP',
    'RP/Liquidator',
    'Resolution Professional',
  ],
  remarks: ['Remarks', 'Remark'],
};

/** Header text as compared: lower-case letters and digits only. */
export function headerKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}
