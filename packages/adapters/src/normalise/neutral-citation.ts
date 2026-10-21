// Neutral-citation normaliser (#369). High Courts cite `2026:MHC:1234` (Madras) or
// `2026:KHC-D:567` (Karnataka, Dharwad Bench); the Supreme Court cites `2026 INSC 123`. Spacing,
// case and leading zeros vary in print; the canonical form is upper case without leading zeros.
// This only reads citations already printed on a document: it never makes one up.

const HIGH_COURT =
  /\b((?:19|20)\d{2})\s*:\s*([A-Za-z]{2,6}(?:-[A-Za-z]{1,3})?)\s*:\s*(\d{1,6})(?:\s*-\s*(DB|FB))?\b/i;
const SUPREME_COURT = /\b((?:19|20)\d{2})\s+INSC\s+(\d{1,6})\b/i;

const unpad = (digits: string) => digits.replace(/^0+(?=\d)/, '');

/** The first neutral citation in `raw`, canonicalised, or null. */
export function normaliseNeutralCitation(raw: string): string | null {
  const sc = SUPREME_COURT.exec(raw);
  if (sc !== null) return `${sc[1] ?? ''} INSC ${unpad(sc[2] ?? '')}`;
  const hc = HIGH_COURT.exec(raw);
  if (hc === null) return null;
  const bench = hc[4] === undefined ? '' : `-${hc[4].toUpperCase()}`;
  return `${hc[1] ?? ''}:${(hc[2] ?? '').toUpperCase()}:${unpad(hc[3] ?? '')}${bench}`;
}
