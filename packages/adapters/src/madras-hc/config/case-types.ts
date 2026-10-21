// Madras HC case types (#395, part 1 of #36): every code named in research/raw/08 §8, read from the
// case-type dropdown of the official cause-list page on 2026-10-17. The dropdown has about 130
// values; this table is `partial` until a lawyer-assisted capture of the full list (#119). Codes are
// the `compactCaseType` form (`CRL OP` -> `CRLOP`, `(T)OP(TM)` -> `TOPTM`); a `(MD)` seat bracket is
// split off as `seatSuffix` by the normaliser, so `WP(MD)` is `WP` at the Madurai Bench. Miscellaneous
// petitions are filed within a main case: `isMisc` with the main case's codes in `parentCodes`.
import { compactCaseType } from '../../normalise/case-type.ts';

export interface MadrasCaseType {
  /** Normal form of `label`. */
  code: string;
  /** As printed in the dropdown. */
  label: string;
  /** Spellings whose normal form differs from `code`. */
  aliases: readonly string[];
  isMisc?: true;
  /** The main-case codes a miscellaneous petition is filed in. */
  parentCodes?: readonly string[];
}

/** Until the full official dropdown is captured (#119). */
export const MADRAS_HC_CASE_TYPES_COMPLETENESS = 'partial' as const;

type Entry = [label: string, aliases?: readonly string[], parentCodes?: readonly string[]];

const MAIN: readonly Entry[] = [
  // Writs
  ['WP', ['Writ Petition']],
  ['WP Crl', ['Crl. W.P.']],
  ['WA', ['Writ Appeal']],
  ['REV.APLW'],
  ['CONT P', ['Contempt Petition']],
  ['CONT A', ['Contempt Appeal']],
  ['HCP', ['Habeas Corpus Petition']],
  // Civil, Appellate Side
  ['SA', ['Second Appeal']],
  ['CMSA'],
  ['AS', ['Appeal Suit']],
  ['CMA', ['Civil Miscellaneous Appeal']],
  ['CMA NPD'],
  ['CMA PD'],
  ['CRP', ['Civil Revision Petition']],
  ['CRP NPD'],
  ['CRP PD'],
  ['CROS.OBJ', ['Cross Objection']],
  ['TR CMA'],
  ['TR AS'],
  ['TR CMP'],
  ['REV.APLC'],
  // Criminal
  ['CRL OP', ['Criminal Original Petition']],
  ['CRL A', ['Criminal Appeal']],
  ['CRL RC', ['Criminal Revision Case']],
  ['CRL REF'],
  ['RT', ['Referred Trial']],
  // Original Side
  ['CS', ['Civil Suit']],
  ['OP', ['Original Petition']],
  ['OA', ['Original Application']],
  ['OSA', ['Original Side Appeal']],
  ['A', ['Application']],
  ['OMS'],
  ['TOS'],
  ['LTS'],
  ['EP', ['Execution Petition']],
  ['IP'],
  ['IA'],
  ['IC'],
  ['IN'],
  ['CP', ['Company Petition']],
  ['COMP.A'],
  ['COM APEL'],
  ['REV.APLO'],
  ['REV.PET'],
  ['TRCS'],
  ['ELP', ['Election Petition']],
  ['SCP'],
  ['SCMP'],
  // Commercial, IP and arbitration
  ['C.S (COMM DIV)', ['C.S. (COM.DIV.)']],
  ['O.P (COMM DIV)', ['O.P. (COM.DIV.)']],
  ['APPEAL (CAD)'],
  ['OSA (CAD)'],
  ['Arb Appln', ['Arb. Application']],
  ['Arb O.P', ['Arbitration Original Petition']],
  ['Arb O.P (COM.DIV.)', ['Arb. O.P. (COMM DIV)']],
  ['Arb Appeal'],
  ['Arb. E.P'],
  ['(T)OP(TM)'],
  ['(T)CMA(TM)'],
  ['(T)OP(CR)'],
  ['(T)OP(PT)'],
  ['(T)OP(GI)'],
  // Tax and trade marks
  ['TC', ['Tax Case']],
  ['TCA'],
  ['TCP'],
  ['TCR'],
  ['TCMP'],
  ['TMA'],
  ['TMSA'],
];

const CIVIL_APPEALS = ['CRP', 'CRPNPD', 'CRPPD', 'CMA', 'CMANPD', 'CMAPD', 'SA', 'AS', 'CMSA'];
const ORIGINAL_SUITS = ['CS', 'CSCOMMDIV', 'OP', 'OPCOMMDIV', 'OA', 'A', 'OSA', 'TOS', 'OMS'];

const MISC: readonly Entry[] = [
  ['WMP', ['Writ Miscellaneous Petition'], ['WP']],
  ['WPMP', [], ['WP']],
  ['WAMP', [], ['WA']],
  ['WVMP', [], ['WP', 'WA']],
  ['VCMP', [], ['WP', 'WA']],
  ['HCMP', [], ['HCP']],
  ['CRL MP', ['Criminal Miscellaneous Petition'], ['CRLOP', 'CRLA', 'CRLRC']],
  ['CMP', ['Civil Miscellaneous Petition'], CIVIL_APPEALS],
  ['SUB A', [], ORIGINAL_SUITS],
  ['SUB APPL', [], ORIGINAL_SUITS],
  ['APPL.', [], ORIGINAL_SUITS],
  ['RCMP', [], ORIGINAL_SUITS],
];

const entry = ([label, aliases = []]: Entry): MadrasCaseType => ({
  code: compactCaseType(label),
  label,
  aliases: aliases.filter((alias) => compactCaseType(alias) !== compactCaseType(label)),
});

export const MADRAS_HC_CASE_TYPES: readonly MadrasCaseType[] = [
  ...MAIN.map(entry),
  ...MISC.map((e) => ({ ...entry(e), isMisc: true as const, parentCodes: e[2] ?? [] })),
];

const BY_CODE = new Map(MADRAS_HC_CASE_TYPES.map((t) => [t.code, t]));

/** The table entry for a normalised code, or undefined for an unknown type. */
export function caseTypeInfo(code: string): MadrasCaseType | undefined {
  return BY_CODE.get(code);
}

/** `nomenclature.caseTypes`: code -> extra spellings. */
export const MADRAS_HC_CASE_TYPE_ALIASES: Readonly<Record<string, string[]>> = Object.fromEntries(
  MADRAS_HC_CASE_TYPES.map((t) => [t.code, [...t.aliases]]),
);
