// Proceeding identity and duplicate matching (#362, part 1 of #33), pure. Case types are written
// many ways (`W.P.`, `WP`, `w.p`; `CRL.P`, `CRL P`), numbers with leading zeros and years with two
// digits, so two records of one proceeding rarely match as typed. A CNR, when both sides carry one,
// decides on its own: it is the court's own identifier (unique per workspace, proceedings.ts).
import { invalid } from '../shared/errors.ts';

/** What identifies a proceeding: a CNR, or case type x number x year (within a forum). */
export interface ProceedingIdentity {
  forumId?: string | null | undefined;
  caseType?: string | null | undefined;
  number?: string | null | undefined;
  year?: number | null | undefined;
  cnr?: string | null | undefined;
}

/**
 * The stored `case_type_code` for a case type as printed: upper-case, without dots, whitespace,
 * hyphens or underscores (`W.P.` → `WP`, `CRL P` → `CRLP`, `W.P.(MD)` → `WP(MD)`). VALIDATION when
 * nothing is left.
 */
export function normaliseCaseType(raw: string): string {
  const code = raw.toUpperCase().replace(/[.\s\-_]/g, '');
  if (code === '') throw invalid('caseType must not be blank');
  return code;
}

/** A case number without the leading zeros of its digits (`00045` → `45`, `0` stays `0`). */
export function normaliseCaseNumber(raw: string): string {
  const value = raw.trim().toUpperCase();
  return value.replace(/^0+(?=\d)/, '');
}

/** A two-digit year expanded with a fixed pivot (00-49 → 20xx, 50-99 → 19xx); others as given. */
export function expandYear(year: number): number {
  if (year >= 0 && year <= 99) return year < 50 ? 2000 + year : 1900 + year;
  return year;
}

function normaliseCnr(cnr: string | null | undefined): string | null {
  const value = cnr?.trim().toUpperCase() ?? '';
  return value === '' ? null : value;
}

/** The normalised case type x number x year key, or null when any part is missing. */
export function identityKey(identity: ProceedingIdentity): string | null {
  const { caseType, number, year } = identity;
  if (caseType == null || number == null || year == null) return null;
  const type = caseType.toUpperCase().replace(/[.\s\-_]/g, '');
  const no = normaliseCaseNumber(number);
  if (type === '' || no === '') return null;
  return `${type}/${no}/${String(expandYear(year))}`;
}

/**
 * Whether two records name the same proceeding. CNR first: when both carry one, they match exactly
 * when the CNRs are equal. Otherwise both need a case type, number and year, equal once
 * normalised, and the forums must agree when both are known.
 */
export function isSameProceeding(a: ProceedingIdentity, b: ProceedingIdentity): boolean {
  const cnrA = normaliseCnr(a.cnr);
  const cnrB = normaliseCnr(b.cnr);
  if (cnrA !== null && cnrB !== null) return cnrA === cnrB;
  if (a.forumId != null && b.forumId != null && a.forumId !== b.forumId) return false;
  const keyA = identityKey(a);
  return keyA !== null && keyA === identityKey(b);
}
