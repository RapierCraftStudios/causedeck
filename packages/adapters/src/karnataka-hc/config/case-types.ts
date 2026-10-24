// Karnataka HC case types (#404, part 1 of #37). The official table (`casetypes.pdf`) could not be
// read (research/raw/09 §6), so this table is `partial` until it is captured with #119. `verified`
// types were seen in orders or in the judgment-search dropdown; the rest are common types assumed
// from practice and flagged `verified: false`. Codes are the `compactCaseType` form (`CRL.P` ->
// `CRLP`, `Comm.A.P` -> `COMMAP`). An interlocutory application (IA) is filed within a main case.
import { compactCaseType } from '../../normalise/case-type.ts';

export interface KarnatakaCaseType {
  /** Normal form of `label`. */
  code: string;
  /** As printed in orders or the dropdown. */
  label: string;
  /** Spellings whose normal form differs from `code`. */
  aliases: readonly string[];
  /** Seen in an order or the official dropdown (research/raw/09 §6). */
  verified: boolean;
  isMisc?: true;
}

/** Until the official `casetypes.pdf` is captured (#119). */
export const KARNATAKA_HC_CASE_TYPES_COMPLETENESS = 'partial' as const;

type Entry = [label: string, aliases?: readonly string[]];

const VERIFIED: readonly Entry[] = [
  ['WP', ['Writ Petition']],
  ['WA', ['Writ Appeal']],
  ['RFA', ['Regular First Appeal']],
  ['RSA', ['Regular Second Appeal']],
  ['MFA', ['Miscellaneous First Appeal']],
  ['CRL.P', ['Criminal Petition']],
  ['CRL.RP', ['Criminal Revision Petition']],
  ['CRL.A', ['Criminal Appeal']],
];

const UNVERIFIED: readonly Entry[] = [
  ['CRP', ['Civil Revision Petition']],
  ['CCC', ['Civil Contempt Case']],
  ['CP', ['Company Petition']],
  ['WPCR', ['WP (CR)', 'Writ Petition (Criminal)']],
  ['WPHC', ['Habeas Corpus Petition']],
  ['COMM.A.P', ['Commercial Appeal']],
  ['COMM.OS'],
  ['MSA', ['Miscellaneous Second Appeal']],
  ['RP', ['Review Petition']],
  ['STRP', ['Sales Tax Revision Petition']],
  ['ITA', ['Income Tax Appeal']],
  ['AC', ['Arbitration Case']],
  ['CRL.CCC'],
];

const MISC: readonly Entry[] = [['IA', ['Interlocutory Application', 'I.A.']]];

const entry = ([label, aliases = []]: Entry, verified: boolean): KarnatakaCaseType => ({
  code: compactCaseType(label),
  label,
  aliases: aliases.filter((alias) => compactCaseType(alias) !== compactCaseType(label)),
  verified,
});

export const KARNATAKA_HC_CASE_TYPES: readonly KarnatakaCaseType[] = [
  ...VERIFIED.map((e) => entry(e, true)),
  ...UNVERIFIED.map((e) => entry(e, false)),
  ...MISC.map((e) => ({ ...entry(e, false), isMisc: true as const })),
];

const BY_CODE = new Map(KARNATAKA_HC_CASE_TYPES.map((t) => [t.code, t]));

/** The table entry for a normalised code, or undefined for an unknown type. Never throws. */
export function karnatakaCaseTypeInfo(code: string): KarnatakaCaseType | undefined {
  return BY_CODE.get(code);
}

/** `nomenclature.caseTypes`: code -> extra spellings. */
export const KARNATAKA_HC_CASE_TYPE_ALIASES: Readonly<Record<string, string[]>> =
  Object.fromEntries(KARNATAKA_HC_CASE_TYPES.map((t) => [t.code, [...t.aliases]]));
