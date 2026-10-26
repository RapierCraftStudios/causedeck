// Case-type normaliser (#369). Courts print the same type many ways: `W.P.`, `WP`, `W. P.`,
// `Crl.O.P.`, `CRL OP`, `Arb.O.P.`. The normal form is the upper-case letters and digits with dots,
// spaces and hyphens removed; a trailing seat bracket such as `(MD)` (Madurai Bench) is split off
// as `seatSuffix`. Adapters add other spellings through `nomenclature.caseTypes`.
export interface CaseTypeOptions {
  /** Normalised code -> extra spellings (`nomenclature.caseTypes`). */
  aliases?: Readonly<Record<string, readonly string[]>>;
  /** Bracketed suffixes that name a seat, e.g. `MD`. Default `['MD']`. */
  seatSuffixes?: readonly string[];
}

export interface ParsedCaseType {
  caseType: string;
  seatSuffix?: string;
}

const DEFAULT_SEAT_SUFFIXES = ['MD'];

/** Upper-case letters and digits only: `Crl. O.P.` -> `CRLOP`. */
export function compactCaseType(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Split a case type into its normal form and seat suffix; null when nothing is left. */
export function parseCaseType(raw: string, options: CaseTypeOptions = {}): ParsedCaseType | null {
  const seats = options.seatSuffixes ?? DEFAULT_SEAT_SUFFIXES;
  let text = raw.trim();
  let seatSuffix: string | undefined;
  const bracket = /\(\s*([A-Za-z.\s]+?)\s*\)\s*\.?$/.exec(text);
  if (bracket !== null) {
    const suffix = compactCaseType(bracket[1] ?? '');
    if (seats.includes(suffix)) {
      seatSuffix = suffix;
      text = text.slice(0, bracket.index);
    }
  }
  let caseType = compactCaseType(text);
  if (caseType === '' || !/^[A-Z]/.test(caseType)) return null;
  for (const [code, spellings] of Object.entries(options.aliases ?? {})) {
    if (spellings.some((spelling) => compactCaseType(spelling) === caseType)) {
      caseType = compactCaseType(code);
      break;
    }
  }
  return seatSuffix === undefined ? { caseType } : { caseType, seatSuffix };
}

/** The normal form of a case type (`W.P.` and `WP` both give `WP`), or null. */
export function normaliseCaseType(raw: string, options: CaseTypeOptions = {}): string | null {
  return parseCaseType(raw, options)?.caseType ?? null;
}
