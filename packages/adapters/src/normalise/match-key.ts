// Match key (#369): the stable identity a parsed row is matched to a proceeding with (#57). Two
// spellings of the same case give the same key: `W.P.(MD) No. 012 of 26` and `WP(MD) 12/2026` are
// both `WP(MD)/12/2026`.

export interface MatchKeyParts {
  caseType: string | null;
  seatSuffix?: string | undefined;
  caseNumber: string | null;
  caseYear: number | null;
}

/** `TYPE(SEAT)/NUMBER/YEAR`, or null when the type, number or year is missing. */
export function matchKey({
  caseType,
  seatSuffix,
  caseNumber,
  caseYear,
}: MatchKeyParts): string | null {
  if (caseType === null || caseNumber === null || caseYear === null) return null;
  const seat = seatSuffix === undefined ? '' : `(${seatSuffix})`;
  return `${caseType}${seat}/${caseNumber}/${String(caseYear)}`;
}
