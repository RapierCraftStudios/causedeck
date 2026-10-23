// A0 proposals (#56): every A0 output is a `ProposalDraft` the person confirms, always `L2`, never
// `L3`, not even for an exact case-number match (A0 is lower trust than a dedicated adapter).
// `ProposalDraft` is a strict object with no level (ADR 0028), and the engine's approval matrix
// routes by kind and by `match.exact`, so L2 is guaranteed here by construction: the level travels
// beside the draft, a draft never sets `match.exact`, and the kinds that can reach L3 unasked
// (`task`, `party_detail`, `document_attach`) are never produced. Confidence is capped at 0.85
// until a row of the same list is confirmed, then 0.95 (display and ranking only).
import {
  anchorKey,
  collectAnchors,
  toProposalDrafts,
  type ExtractionAnchor,
  type ProposalContext,
} from '@causedeck/intelligence/extract';
import type { ProposalDraft } from '@causedeck/validators/proposal-draft';

import { matchRow, type RowMatch, type WorkspaceIdentifiers } from './confirmation.ts';
import {
  A0_CONFIDENCE_CAP,
  A0_CONFIRMED_CAP,
  READ_WITHOUT_AI_NOTE,
  type A0Anchor,
  type A0ParsedOrder,
  type A0Row,
} from './validate.ts';

/** The one level an A0 draft may be proposed at. */
export const A0_PROPOSED_LEVEL = 'L2' as const;

/** Kinds that core's approval matrix can send to L3 unasked: A0 never produces them. */
export const A0_FORBIDDEN_KINDS = ['task', 'party_detail', 'document_attach'] as const;
const ORDER_KINDS = new Set([
  'next_date',
  'order_record',
  'obligation_from_direction',
  'listing_update',
]);

export interface A0Proposal {
  proposedLevel: typeof A0_PROPOSED_LEVEL;
  draft: ProposalDraft;
  /** `read without AI` when no model ran; shown on the card. */
  note?: string;
}

/** The matter graph's answer for one matched row. */
export interface A0RowTarget {
  row: A0Row;
  match: RowMatch;
  matterId?: string | null;
  proceedingId?: string | null;
  /** The listing the row would update, when the matter graph knows it. */
  listingId?: string | null;
}

export interface A0ProposalContext {
  documentId: string;
  captureId?: string | null;
  /** The `ai_call` behind the model step; null when no model ran. */
  aiCallId?: string | null;
  /** The list's date (ISO), from its anchored phrase. */
  listDate?: { iso: string; anchor: A0Anchor } | null;
  /** Persisted `anchor` row ids by `anchorKey`. */
  anchorIds: ReadonlyMap<string, string>;
  /** A row of the same list has been confirmed (display cap 0.95, level still L2). */
  listConfirmed?: boolean;
}

/** The distinct anchors of rows (and the list date) to persist as `anchor` rows before drafting. */
export function collectA0Anchors(
  documentId: string,
  rows: readonly A0Row[],
  listDate?: { anchor: A0Anchor } | null,
): ExtractionAnchor[] {
  const all = [...rows.map((r) => r.anchor), ...(listDate == null ? [] : [listDate.anchor])];
  const seen = new Map<string, ExtractionAnchor>();
  for (const a of all) {
    const anchor: ExtractionAnchor = {
      documentId,
      page: a.page,
      quote: a.quote,
      charStart: a.charStart,
      charEnd: a.charEnd,
    };
    if (!seen.has(anchorKey(anchor))) seen.set(anchorKey(anchor), anchor);
  }
  return [...seen.values()];
}

/** The most confidence an A0 draft claims. */
export function capConfidence(confidence: number, listConfirmed: boolean): number {
  return Math.min(confidence, listConfirmed ? A0_CONFIRMED_CAP : A0_CONFIDENCE_CAP);
}

/** Drafts for the matched rows of a list: a next date and, when the row has one, an item number. */
export function a0ToProposalDrafts(
  targets: readonly A0RowTarget[],
  ctx: A0ProposalContext,
): A0Proposal[] {
  const idOf = (a: A0Anchor): string => {
    const found = ctx.anchorIds.get(anchorKey(a));
    if (found === undefined)
      throw new Error(`a0ToProposalDrafts: anchor ${anchorKey(a)} not persisted`);
    return found;
  };
  const listConfirmed = ctx.listConfirmed === true;
  const proposals: A0Proposal[] = [];
  for (const { row, match, matterId, proceedingId, listingId } of targets) {
    const ai = row.origin !== 'skeleton' && ctx.aiCallId != null;
    const base = {
      ...(ctx.captureId == null ? {} : { captureId: ctx.captureId }),
      ...(matterId == null ? {} : { matterId }),
      ...(proceedingId == null ? {} : { proceedingId }),
      source: {
        type: ai ? ('ai' as const) : ('deterministic' as const),
        input: 'list',
        ref: ctx.documentId,
        ...(ai && ctx.aiCallId != null ? { aiCallId: ctx.aiCallId } : {}),
      },
      confidence: capConfidence(row.confidence, listConfirmed),
      // A score only: `match.exact` would let the engine apply the draft unasked.
      match: { score: match.score },
      ...(row.issues.some((i) => i.code === 'injection_suspected' || i.code === 'unknown_case_type')
        ? { ambiguous: true }
        : {}),
    };
    const note = row.note === READ_WITHOUT_AI_NOTE ? { note: READ_WITHOUT_AI_NOTE } : {};
    const date = ctx.listDate;
    if (date != null && proceedingId != null) {
      proposals.push({
        proposedLevel: A0_PROPOSED_LEVEL,
        draft: {
          ...base,
          kind: 'next_date',
          payload: { proceedingId, date: date.iso },
          anchors: [idOf(date.anchor), idOf(row.anchor)],
          patternKey: 'a0:list_date',
        },
        ...note,
      });
    }
    if (listingId != null && row.serial !== undefined) {
      proposals.push({
        proposedLevel: A0_PROPOSED_LEVEL,
        draft: {
          ...base,
          kind: 'listing_update',
          payload: { listingId, itemNo: row.serial },
          anchors: [idOf(row.anchor)],
          patternKey: 'a0:list_row',
        },
        ...note,
      });
    }
  }
  return proposals;
}

/** How an order's identities (its case numbers and CNRs) match the workspace, or null. */
export function matchOrder(order: A0ParsedOrder, ids: WorkspaceIdentifiers): RowMatch | null {
  let best: RowMatch | null = null;
  for (const identity of order.identities) {
    const match = matchRow(
      {
        ...(identity.cnr === undefined ? {} : { cnr: identity.cnr }),
        ...(identity.caseRef === undefined ? {} : { caseRef: identity.caseRef }),
      },
      ids,
    );
    if (match !== null && (best === null || match.score > best.score)) best = match;
  }
  for (const { party } of order.parties) {
    const match = matchRow({ parties: party }, ids);
    if (match !== null && best === null) best = match;
  }
  return best;
}

/**
 * Drafts for an order that matches a workspace identifier (otherwise `[]`: it is returned to the
 * caller for discard). The rules are #46's; `task` drafts are dropped and confidence is capped.
 */
export function a0OrderToProposalDrafts(
  order: A0ParsedOrder,
  ids: WorkspaceIdentifiers,
  ctx: ProposalContext & { listConfirmed?: boolean },
): A0Proposal[] {
  const match = matchOrder(order, ids);
  if (match === null) return [];
  const unknownType = order.issues.some((i) => i.code === 'unknown_case_type');
  const note = order.diagnostics.modelUsed ? {} : { note: READ_WITHOUT_AI_NOTE };
  return toProposalDrafts(order.extraction, ctx)
    .filter((d) => ORDER_KINDS.has(d.kind))
    .map((d) => ({
      proposedLevel: A0_PROPOSED_LEVEL,
      draft: {
        ...d,
        confidence: capConfidence(d.confidence ?? order.confidence, ctx.listConfirmed === true),
        match: { score: match.score },
        ...(unknownType ? { ambiguous: true } : {}),
      },
      ...note,
    }));
}

/** The anchors of an order's extraction, to persist before `a0OrderToProposalDrafts`. */
export const collectOrderAnchors = (order: A0ParsedOrder): ExtractionAnchor[] =>
  collectAnchors(order.extraction);
