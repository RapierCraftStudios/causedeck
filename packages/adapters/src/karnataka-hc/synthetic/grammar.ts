// Shared grammar of the Karnataka HC synthetic documents (#408): the document and truth types,
// the case types the case-line grammar reads (case-line.ts, config/case-types.ts) and date helpers
// that use UTC arithmetic only, never the clock or the locale. Test tooling only: not exported from
// the package entry.

export type GeneratedKind = 'cause_list' | 'order' | 'registry_notice';
export type GeneratedFormat = 'html' | 'pdf' | 'txt';

/** A list row as the parser should report it: the `SCORED_ROW_FIELDS` of testing/golden.ts. */
export interface KarnatakaTruthRow {
  hallNo: string;
  itemNo: string;
  caseTypeRaw: string;
  caseType: string;
  seatSuffix: null;
  caseNumber: string;
  caseYear: number;
  matchKey: string;
  parties: string;
  stageRaw: string | null;
  stageNorm: string | null;
}

export interface KarnatakaTruth {
  /** The list date (cause lists). */
  listDate?: string;
  rows?: KarnatakaTruthRow[];
  /** The order date (orders). */
  orderDate?: string;
  /** Every ISO date the document prints, or that follows from a printed date and period. */
  dates: string[];
}

export interface GeneratedDocument {
  name: string;
  kind: GeneratedKind;
  format: GeneratedFormat;
  content: string | Uint8Array;
  truth: KarnatakaTruth;
}

export interface GenerateKarnatakaOptions {
  seed: number;
  lists?: number;
  orders?: number;
  notices?: number;
}

export interface GeneratedFixtures {
  seed: number;
  documents: GeneratedDocument[];
}

export interface CaseType {
  /** As lists print it before `No.`. */
  printed: string;
  code: string;
  /** As an order's case line spells it out. */
  title: string;
  /** `of YEAR` rather than `/YEAR`. */
  of?: true;
  /** Writ categories printed in brackets after the number. */
  categories?: readonly string[];
}

/** Spellings the case-line grammar reads (case-line.ts), each a code in the case-type table. */
export const CASE_TYPES: readonly CaseType[] = [
  { printed: 'WP', code: 'WP', title: 'WRIT PETITION', categories: ['GM-RES', 'S-RES', 'LB-RES'] },
  {
    printed: 'W.P.',
    code: 'WP',
    title: 'WRIT PETITION',
    of: true,
    categories: ['GM-RES', 'T-RES'],
  },
  { printed: 'WA', code: 'WA', title: 'WRIT APPEAL', of: true },
  { printed: 'RFA', code: 'RFA', title: 'REGULAR FIRST APPEAL' },
  { printed: 'RSA', code: 'RSA', title: 'REGULAR SECOND APPEAL' },
  { printed: 'MFA', code: 'MFA', title: 'MISCELLANEOUS FIRST APPEAL' },
  { printed: 'CRL.P', code: 'CRLP', title: 'CRIMINAL PETITION', of: true },
  { printed: 'CRL.RP', code: 'CRLRP', title: 'CRIMINAL REVISION PETITION' },
  { printed: 'CRL.A', code: 'CRLA', title: 'CRIMINAL APPEAL', of: true },
  { printed: 'CRP', code: 'CRP', title: 'CIVIL REVISION PETITION' },
];

export const int = (random: () => number, min: number, max: number): number =>
  min + Math.floor(random() * (max - min + 1));
export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A calendar day as ISO, `days` after 2026-01-01 (UTC arithmetic, never the clock). */
export function isoDay(days: number): string {
  const date = new Date(Date.UTC(2026, 0, 1 + days));
  return `${String(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDay(
    Math.round((Date.UTC(y ?? 2026, (m ?? 1) - 1, (d ?? 1) + days) - Date.UTC(2026, 0, 1)) / 864e5),
  );
};

/** `dd.mm.yyyy` or `dd-mm-yyyy`. */
export const numeric = (iso: string, separator = '.'): string => {
  const [y, m, d] = iso.split('-');
  return [d, m, y].join(separator);
};
