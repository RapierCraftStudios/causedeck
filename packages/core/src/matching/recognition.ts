// Recognition-based matching (#74, PRD ME-2, docs/product/10 §3): M7 aliases and shorthand a lawyer
// confirmed raise or lower the ambiguity ranking of cause-list and order match candidates, so the
// confirmations the lawyer is asked for fall over time. Memory is a hint only: `autoApplyAllowed`
// (the L3 gate, docs/product/09 §4.2) is true only when the case number or the CNR matches exactly,
// so no alias can cause an unsafe auto-apply. Nothing here reads memory about a judge or a bench.
import { readAlias, type MemoryCorrectionInput, type MemoryProposal } from '@causedeck/validators';

import {
  memoryFor,
  proposeFromCorrection,
  recordUsage,
  type MemoryActor,
  type MemoryDeps,
} from '../memory/index.ts';

/** What came in: the identifiers and the free text (party or matter wording) to be matched. */
export interface MatchInput {
  caseNumber?: string | null;
  cnr?: string | null;
  /** Party or matter wording as typed or as printed on the list. */
  text?: string | null;
}

export interface MatchCandidate {
  id: string;
  caseNumber?: string | null;
  cnr?: string | null;
  /** Party names and the matter title, as stored. */
  names: string[];
  /** The base score from the identifier and text match, 0..1. */
  score: number;
}

/** A confirmed M7 alias (a memory item the caller read through `recognitionHints`). */
export interface RecognitionHint {
  itemId?: string;
  alias: string;
  canonical: string;
  target: 'party' | 'matter';
}

export type ProposalLevel = 'L2' | 'L3';

export interface RankedCandidate extends MatchCandidate {
  /** The score after hints, 0..1. */
  rankScore: number;
  /** An exact case-number or CNR match: the only thing that allows an automatic apply. */
  exact: boolean;
  autoApplyAllowed: boolean;
  /** L3 only with an exact identifier; every other proposal is L2 (the lawyer confirms). */
  level: ProposalLevel;
  /** The memory items whose alias moved this candidate. */
  hintItemIds: string[];
}

/** Boost for a candidate that carries the canonical name of an alias found in the input. */
export const ALIAS_BOOST = 0.25;
/** Penalty for a candidate that does not, when some other candidate does. */
export const ALIAS_PENALTY = 0.1;
/** The lead the top candidate needs over the second to be proposed without asking the lawyer. */
export const CONFIDENT_MARGIN = 0.2;

const norm = (v: string | null | undefined): string =>
  (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const ident = (v: string | null | undefined): string => norm(v).replace(/[\s/.-]+/g, '');
const clamp = (n: number): number => Math.min(1, Math.max(0, n));

const isExact = (input: MatchInput, c: MatchCandidate): boolean => {
  const caseNo = ident(input.caseNumber);
  const cnr = ident(input.cnr);
  return (caseNo !== '' && caseNo === ident(c.caseNumber)) || (cnr !== '' && cnr === ident(c.cnr));
};

const holds = (c: MatchCandidate, canonical: string): boolean =>
  c.names.some((n) => norm(n).includes(norm(canonical)));

/**
 * Rank candidates, best first. A hint applies when its alias is in the input text: candidates that
 * carry the canonical name are boosted and, when at least one does, the others are lowered. The
 * exact-identifier gate is computed from the identifiers alone.
 */
export function rankCandidates(
  input: MatchInput,
  candidates: readonly MatchCandidate[],
  hints: readonly RecognitionHint[],
): RankedCandidate[] {
  const text = norm(input.text);
  const applicable = hints.filter((h) => norm(h.alias) !== '' && text.includes(norm(h.alias)));
  const ranked = candidates.map((c): RankedCandidate => {
    const exact = isExact(input, c);
    let score = c.score;
    const hintItemIds: string[] = [];
    for (const h of applicable) {
      const anyHolds = candidates.some((o) => holds(o, h.canonical));
      if (holds(c, h.canonical)) {
        score += ALIAS_BOOST;
        if (h.itemId !== undefined) hintItemIds.push(h.itemId);
      } else if (anyHolds) {
        score -= ALIAS_PENALTY;
      }
    }
    return {
      ...c,
      rankScore: clamp(score),
      exact,
      autoApplyAllowed: exact,
      level: exact ? 'L3' : 'L2',
      hintItemIds,
    };
  });
  return ranked.sort((a, b) => b.rankScore - a.rankScore || a.id.localeCompare(b.id));
}

/** Whether the lawyer still has to pick: no candidate, or no clear lead over the second. */
export function needsConfirmation(ranked: readonly RankedCandidate[]): boolean {
  const [top, second] = ranked;
  if (top === undefined) return true;
  if (top.autoApplyAllowed) return false;
  return second !== undefined && top.rankScore - second.rankScore < CONFIDENT_MARGIN;
}

/** The actor's confirmed M7 aliases (paused, deleted and everyone else's are never returned). */
export async function recognitionHints(
  deps: MemoryDeps,
  actor: MemoryActor,
): Promise<RecognitionHint[]> {
  const { items } = await memoryFor(deps, actor, { layers: ['M7'], purpose: 'matching' });
  const hints: RecognitionHint[] = [];
  for (const item of items) {
    const alias = readAlias(item.value);
    if (alias === null) continue;
    hints.push({
      itemId: item.id,
      ...alias,
      target: item.key === 'M7.matter_alias' ? 'matter' : 'party',
    });
  }
  return hints;
}

/** Rank with the actor's memory and cite each alias that moved a candidate (`used_in` 'matching'). */
export async function rankWithMemory(
  deps: MemoryDeps,
  actor: MemoryActor,
  input: MatchInput,
  candidates: readonly MatchCandidate[],
  outputRef: string,
): Promise<RankedCandidate[]> {
  const ranked = rankCandidates(input, candidates, await recognitionHints(deps, actor));
  const cited = new Set(ranked.flatMap((c) => c.hintItemIds));
  for (const itemId of cited) {
    await recordUsage(deps, actor, { itemId, usedIn: 'matching', outputRef });
  }
  return ranked;
}

/**
 * The lawyer corrected a match ('Rajan' is 'M. Rajan s/o Murugan'): file an M7 alias proposal.
 * Nothing is saved until the lawyer confirms it (#72); once confirmed, `recognitionHints` returns
 * it and the same input ranks the corrected candidate first.
 */
export function learnFromCorrection(
  deps: MemoryDeps,
  actor: MemoryActor,
  correction: MemoryCorrectionInput,
): Promise<MemoryProposal | null> {
  return proposeFromCorrection(deps, actor, correction);
}
