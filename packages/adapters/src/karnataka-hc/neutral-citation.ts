// Karnataka HC neutral citation (#406, part 3 of #37). Judgments carry `YYYY:KHC:n` (Principal Bench,
// Bengaluru), `YYYY:KHC-D:n` (Dharwad Bench) or, by our guess, `YYYY:KHC-K:n` (Kalaburagi Bench), with
// `-DB` after the number for a division bench (ADR 0019, A8). Spacing and case vary in print, so both
// are tolerated; the canonical form comes from the shared `normaliseNeutralCitation`. Other courts'
// citations (`2026:MHC:1234`) are ignored. This only reads a citation already printed on the
// document: it never makes one up.
import { normaliseNeutralCitation } from '../normalise/neutral-citation.ts';

export const KARNATAKA_NEUTRAL_CITATION =
  /\b(\d{4})\s*:\s*KHC(?:\s*-\s*([DK]))?\s*:\s*(\d{1,7})(\s*-\s*DB)?\b/i;

export type KarnatakaCitationBench = 'bengaluru' | 'dharwad' | 'kalaburagi';

export interface KarnatakaNeutralCitation {
  /** `2026:KHC-D:567`, `2026:KHC:89-DB`. */
  normalised: string;
  /** The citation verbatim, as printed. */
  raw: string;
  /** No letter: Bengaluru; `D`: Dharwad; `K`: Kalaburagi (a guess, ADR 0019). */
  bench: KarnatakaCitationBench;
  /** A `-DB` suffix: a division-bench judgment. */
  divisionBench: boolean;
  /** Offset of `raw` in the searched text. */
  index: number;
}

/** The first Karnataka HC neutral citation in `text`, or null. Never throws. */
export function findKarnatakaNeutralCitation(text: string): KarnatakaNeutralCitation | null {
  const match = KARNATAKA_NEUTRAL_CITATION.exec(text);
  if (match === null) return null;
  const letter = match[2]?.toUpperCase();
  // The shared normaliser does not allow spaces around the bench hyphen, so it gets the compact form.
  const compact = `${match[1] ?? ''}:KHC${letter === undefined ? '' : `-${letter}`}:${match[3] ?? ''}${match[4] === undefined ? '' : '-DB'}`;
  const normalised = normaliseNeutralCitation(compact);
  if (normalised === null) return null;
  return {
    normalised,
    raw: match[0],
    bench: letter === 'D' ? 'dharwad' : letter === 'K' ? 'kalaburagi' : 'bengaluru',
    divisionBench: match[4] !== undefined,
    index: match.index,
  };
}
