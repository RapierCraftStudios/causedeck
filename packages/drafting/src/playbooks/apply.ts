// Playbook apply and precedent ranking (#902, #81). Pure functions: no I/O, no clock, no model.
// Applying a playbook changes only what the lawyer approved in it (the standard prayers and the
// annexure order); every other block is returned as it was. Ranking is a fixed weighted sum of
// court, kind, language and similarity, so the same inputs always give the same order and each
// suggestion carries the reasons it scored. Nothing here learns from, or trains on, a draft.
import type { Playbook } from '@causedeck/validators';
import type { Block } from '@causedeck/validators/drafting';

import { collectNarratives } from '../blocks';
import { mapBlocks } from './style-profile';

export const PRAYER_SECTION_ID = 'prayer';
export const ANNEXURES_SECTION_ID = 'annexures';

/** A precedent passage as the ranker needs it; callers map the core `PrecedentView` onto this. */
export interface PrecedentCandidate {
  passageId: string;
  courtId: string | null;
  kind: string;
  language: string;
  /** Cosine distance to the block (smaller is nearer); absent when no embedding was compared. */
  distance?: number;
}

export interface RankQuery {
  courtId: string | null;
  kind: string | null;
  language: string;
}

export type RankReasonCode = 'court' | 'any_court' | 'kind' | 'language' | 'similarity';

export interface RankReason {
  code: RankReasonCode;
  text: string;
}

export interface RankedPrecedent {
  passageId: string;
  score: number;
  reasons: RankReason[];
}

/** Weights sum to 100; similarity is one input among four, not the ranking by itself. */
export const RANK_WEIGHTS = { court: 40, kind: 25, language: 20, similarity: 15 } as const;
const ANY_COURT_SHARE = 0.25;

export function rankPrecedents(
  candidates: readonly PrecedentCandidate[],
  query: RankQuery,
): RankedPrecedent[] {
  const ranked = candidates.map((c): RankedPrecedent => {
    let score = 0;
    const reasons: RankReason[] = [];
    if (query.courtId !== null && c.courtId === query.courtId) {
      score += RANK_WEIGHTS.court;
      reasons.push({ code: 'court', text: 'Written for the same court' });
    } else if (c.courtId === null) {
      score += RANK_WEIGHTS.court * ANY_COURT_SHARE;
      reasons.push({ code: 'any_court', text: 'Not tied to a court' });
    }
    if (query.kind !== null && c.kind === query.kind) {
      score += RANK_WEIGHTS.kind;
      reasons.push({ code: 'kind', text: `Same kind of passage (${c.kind})` });
    }
    if (c.language === query.language) {
      score += RANK_WEIGHTS.language;
      reasons.push({ code: 'language', text: `Same language (${c.language})` });
    }
    if (c.distance !== undefined && Number.isFinite(c.distance)) {
      const similarity = Math.min(1, Math.max(0, 1 - c.distance));
      score += RANK_WEIGHTS.similarity * similarity;
      if (similarity > 0) {
        reasons.push({
          code: 'similarity',
          text: `Similar to this block (${String(Math.round(similarity * 100))}%)`,
        });
      }
    }
    return { passageId: c.passageId, score: Math.round(score * 1000) / 1000, reasons };
  });
  return ranked.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.passageId < b.passageId ? -1 : 1,
  );
}

/** Rank the same candidates for each narrative block; `queryFor` gives the block's own query. */
export function rankForNarratives(
  blocks: readonly Block[],
  candidates: readonly PrecedentCandidate[],
  queryFor: (blockKey: string) => RankQuery,
): Map<string, RankedPrecedent[]> {
  const out = new Map<string, RankedPrecedent[]>();
  for (const { key } of collectNarratives(blocks)) {
    out.set(key, rankPrecedents(candidates, queryFor(key)));
  }
  return out;
}

export interface ApplyContext {
  /** The court of the draft; a court-specific playbook applies only when it matches. */
  courtId: string | null;
  /** The draft's document format; when given, it must match the playbook's. */
  format?: string;
}

export interface PlaybookChange {
  kind: 'prayers' | 'annexure_order';
  blockId: string;
}

export interface ApplyResult {
  blocks: Block[];
  changes: PlaybookChange[];
  skipped?: 'court_mismatch' | 'format_mismatch';
}

function textOf(block: Block): string | null {
  return block.type === 'paragraph' || block.type === 'heading' ? block.text : null;
}

function sameText(a: readonly Block[], b: readonly Block[]): boolean {
  return a.length === b.length && a.every((block, i) => block === b[i]);
}

/** Order children by the playbook's annexure list; others keep their order after the listed ones. */
function orderAnnexures(children: readonly Block[], order: readonly string[]): Block[] {
  const rank = (block: Block): number => {
    const at = order.indexOf(textOf(block) ?? '');
    return at < 0 ? order.length : at;
  };
  return children
    .map((block, index) => ({ block, index, rank: rank(block) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.block);
}

export function applyPlaybook(
  blocks: readonly Block[],
  playbook: Playbook,
  context: ApplyContext,
): ApplyResult {
  if (playbook.courtId !== null && playbook.courtId !== context.courtId) {
    return { blocks: [...blocks], changes: [], skipped: 'court_mismatch' };
  }
  if (context.format !== undefined && context.format !== playbook.format) {
    return { blocks: [...blocks], changes: [], skipped: 'format_mismatch' };
  }
  const changes: PlaybookChange[] = [];
  const next = mapBlocks(blocks, (block) => {
    if (block.type !== 'section') return block;
    if (block.id === PRAYER_SECTION_ID && playbook.standardPrayers.length > 0) {
      const list: Block = {
        type: 'list',
        ordered: true,
        children: playbook.standardPrayers.map((text): Block => ({ type: 'paragraph', text })),
      };
      changes.push({ kind: 'prayers', blockId: PRAYER_SECTION_ID });
      return { ...block, children: [list] };
    }
    if (block.id === ANNEXURES_SECTION_ID && playbook.annexureOrder.length > 0) {
      const children = orderAnnexures(block.children, playbook.annexureOrder);
      if (sameText(children, block.children)) return block;
      changes.push({ kind: 'annexure_order', blockId: ANNEXURES_SECTION_ID });
      return { ...block, children };
    }
    return block;
  });
  return { blocks: next, changes };
}
