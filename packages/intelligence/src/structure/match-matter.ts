// Matter matching for a spoken hearing note (#541). Candidates are ranked from the case numbers
// said aloud (normalised with the adapter normalisers, so `12345 of 2026`, `12345/2026` and
// `12345/26` are one number), party names (alias-aware) and an optional listing context (the
// listing or matter the person was looking at). A match the engine may take unasked (>= 0.9, the
// L3 gate) needs an exact case number AND a listing that agrees; with only one of them, or with
// party names alone, the proposal carries up to three candidates for the person to choose from.
import { normaliseCaseNumber, type CaseNumber } from '@causedeck/adapters';

export interface MatterCandidate {
  matterId: string;
  proceedingId?: string | undefined;
  /** Case numbers of the matter's proceedings, as written (`W.P. No. 123 of 2026`). */
  caseNumbers: readonly string[];
  /** Party names and their aliases (short names, former names, transliterations). */
  parties: readonly string[];
}

/** What the person was looking at when they recorded: a matter, or a listing's case number. */
export interface ListingContext {
  matterId?: string | undefined;
  caseNumber?: string | undefined;
}

export interface RankedMatter {
  matterId: string;
  proceedingId?: string | undefined;
  /** 0-1. */
  score: number;
  exact: 'case_number' | null;
  contextAgrees: boolean;
  partyScore: number;
}

export interface MatchResult {
  /** The matter to attach to unasked: only with an exact case number and a listing that agrees. */
  matched: RankedMatter | null;
  /** Up to three candidates, best first; empty without an identifier, context or party name. */
  candidates: RankedMatter[];
}

export const MATCH_MIN_SCORE = 0.9;
export const MAX_CANDIDATES = 3;
const EXACT_SCORE = 0.85;
const CONTEXT_BONUS = 0.1;
const PARTY_WEIGHT = 0.6;
const CONTEXT_ONLY_SCORE = 0.5;
const MIN_LISTED_SCORE = 0.2;

const SPOKEN_NUMBER = /\d{1,7}\s*(?:\/|\bof\b|-)\s*(?:\d{4}|\d{2})\b/giu;

/** Every case number in `text`, normalised. */
export function spokenCaseNumbers(text: string): CaseNumber[] {
  return [...text.matchAll(SPOKEN_NUMBER)].flatMap((match) => {
    const number = normaliseCaseNumber(match[0]);
    return number === null ? [] : [number];
  });
}

const sameNumber = (a: CaseNumber, b: CaseNumber): boolean =>
  a.number === b.number && a.year === b.year;

const NAME_NOISE = new Set([
  'vs',
  'v',
  'versus',
  'and',
  'the',
  'of',
  'm/s',
  'shri',
  'smt',
  'mr',
  'mrs',
]);

const nameTokens = (name: string): string[] =>
  name
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((token) => token.length > 0 && !NAME_NOISE.has(token));

/** The best share of a party name's tokens that `text` contains, over all `names`. */
function partyScore(text: string, names: readonly string[]): number {
  const said = new Set(nameTokens(text));
  let best = 0;
  for (const name of names) {
    const tokens = nameTokens(name);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((token) => said.has(token)).length;
    // A one-word name must match whole; a longer one needs at least two words said.
    if (tokens.length === 1 ? hits === 1 : hits >= 2) best = Math.max(best, hits / tokens.length);
  }
  return best;
}

export function rankMatters(
  text: string,
  candidates: readonly MatterCandidate[],
  context?: ListingContext,
): MatchResult {
  const spoken = spokenCaseNumbers(text);
  const contextNumber =
    context?.caseNumber === undefined ? null : normaliseCaseNumber(context.caseNumber);
  const ranked = candidates.flatMap((candidate): RankedMatter[] => {
    const numbers = candidate.caseNumbers.flatMap((c) => {
      const n = normaliseCaseNumber(c);
      return n === null ? [] : [n];
    });
    const exact = spoken.some((s) => numbers.some((n) => sameNumber(s, n)));
    const contextAgrees =
      (context?.matterId !== undefined && context.matterId === candidate.matterId) ||
      (contextNumber !== null && numbers.some((n) => sameNumber(n, contextNumber)));
    const party = partyScore(text, candidate.parties);
    let score = party * PARTY_WEIGHT;
    if (exact) score = EXACT_SCORE + (contextAgrees ? CONTEXT_BONUS : 0) + party * 0.04;
    else if (contextAgrees) score = Math.max(score, CONTEXT_ONLY_SCORE + party * 0.2);
    // Nothing but the exact-plus-context pair may reach the L3 gate.
    if (!(exact && contextAgrees)) score = Math.min(score, MATCH_MIN_SCORE - 0.01);
    if (score < MIN_LISTED_SCORE) return [];
    return [
      {
        matterId: candidate.matterId,
        proceedingId: candidate.proceedingId,
        score: Math.min(0.99, Number(score.toFixed(4))),
        exact: exact ? 'case_number' : null,
        contextAgrees,
        partyScore: party,
      },
    ];
  });
  ranked.sort((a, b) => b.score - a.score || a.matterId.localeCompare(b.matterId));
  const [best, second] = ranked;
  const unique =
    best !== undefined && best.score >= MATCH_MIN_SCORE && second?.score !== best.score;
  return { matched: unique ? best : null, candidates: ranked.slice(0, MAX_CANDIDATES) };
}
