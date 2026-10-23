// `toProposalDrafts` (#46): an extraction becomes `ProposalDraft`s for the automation engine
// (#47), under the contract that landed with it. A draft proposes; it changes nothing. Levels are
// the engine's (`APPROVAL_MATRIX`): `next_date`, `obligation_from_direction`, `order_record` and
// `listing_update` are always L2, and only an undated `task` at confidence >= 0.8 can reach L3. A
// deterministic-only extraction never claims more than 0.6, so all of it stays L2. There is no
// draft for an outward action: `outward_draft` is never produced here.
import type { ProposalDraft } from '@causedeck/validators/proposal-draft';

import type { ExtractionAnchor, NextDate, OrderExtraction } from './schema.ts';

export interface ProposalContext {
  captureId?: string | null;
  matterId?: string | null;
  proceedingId?: string | null;
  /** The listing a stage cue would update, when the matter graph knows it. */
  listingId?: string | null;
  /** The `ai_call` behind the model step. */
  aiCallId?: string | null;
  /** Persisted `anchor` row ids by `anchorKey` (see `collectAnchors`). */
  anchorIds: ReadonlyMap<string, string>;
}

export const anchorKey = (a: Pick<ExtractionAnchor, 'page' | 'charStart' | 'charEnd'>): string =>
  `${String(a.page)}:${String(a.charStart)}:${String(a.charEnd)}`;

/** Every distinct anchor of the extraction, to persist as `anchor` rows before drafting. */
export function collectAnchors(extraction: OrderExtraction): ExtractionAnchor[] {
  const all: ExtractionAnchor[] = [
    ...extraction.bench.map((b) => b.anchor),
    ...(extraction.orderDate ? [extraction.orderDate.anchor] : []),
    ...extraction.caseNumbers.map((c) => c.anchor),
    ...(extraction.neutralCitation ? [extraction.neutralCitation.anchor] : []),
    ...extraction.directions.map((d) => d.anchor),
    ...(extraction.nextDate ? [extraction.nextDate.anchor] : []),
    ...extraction.candidates.map((c) => c.anchor),
    ...extraction.stageCues.map((s) => s.anchor),
  ];
  const seen = new Map<string, ExtractionAnchor>();
  for (const a of all) if (!seen.has(anchorKey(a))) seen.set(anchorKey(a), a);
  return [...seen.values()];
}

export function toProposalDrafts(
  extraction: OrderExtraction,
  ctx: ProposalContext,
): ProposalDraft[] {
  const idOf = (a: ExtractionAnchor): string => {
    const found = ctx.anchorIds.get(anchorKey(a));
    if (found === undefined)
      throw new Error(`toProposalDrafts: anchor ${anchorKey(a)} not persisted`);
    return found;
  };
  // Demoted dates, several candidates and instruction-like orders are always a card for the person.
  const demoted = extraction.suspicious || extraction.ambiguous;
  const base = {
    ...(ctx.captureId == null ? {} : { captureId: ctx.captureId }),
    ...(ctx.matterId == null ? {} : { matterId: ctx.matterId }),
    ...(ctx.proceedingId == null ? {} : { proceedingId: ctx.proceedingId }),
    source: {
      type: extraction.deterministicOnly ? ('deterministic' as const) : ('ai' as const),
      input: 'document',
      ref: extraction.documentId,
      ...(extraction.deterministicOnly || ctx.aiCallId == null ? {} : { aiCallId: ctx.aiCallId }),
    },
    confidence: extraction.confidence,
  };
  const drafts: ProposalDraft[] = [];

  const nextDateDraft = (n: NextDate): ProposalDraft => ({
    ...base,
    kind: 'next_date',
    payload: {
      ...(ctx.proceedingId == null ? {} : { proceedingId: ctx.proceedingId }),
      date: n.date,
    },
    anchors: [idOf(n.anchor)],
    patternKey: n.derived === true ? 'order:next_date_derived' : 'order:next_date_literal',
    ...(demoted ? { ambiguous: true } : {}),
  });
  if (extraction.nextDate !== undefined) drafts.push(nextDateDraft(extraction.nextDate));
  else for (const c of extraction.candidates) drafts.push(nextDateDraft(c));

  if (extraction.orderDate !== undefined) {
    drafts.push({
      ...base,
      kind: 'order_record',
      payload: {
        ...(ctx.proceedingId == null ? {} : { proceedingId: ctx.proceedingId }),
        documentId: extraction.documentId,
        orderDate: extraction.orderDate.date,
        orderType: extraction.orderType,
        neutralCitation: extraction.neutralCitation?.value ?? null,
        operativeDirections: extraction.directions.map((d) => ({
          text: d.text,
          anchorId: idOf(d.anchor),
        })),
        nextDate: extraction.nextDate?.date ?? null,
      },
      anchors: [
        idOf(extraction.orderDate.anchor),
        ...(extraction.neutralCitation ? [idOf(extraction.neutralCitation.anchor)] : []),
        ...extraction.directions.map((d) => idOf(d.anchor)),
      ].slice(0, 50),
      patternKey: 'order:record',
      ...(demoted ? { ambiguous: true } : {}),
    });
  }

  for (const d of extraction.directions) {
    if (d.dueDate !== undefined) {
      drafts.push({
        ...base,
        kind: 'obligation_from_direction',
        payload: {
          ...(ctx.matterId == null ? {} : { matterId: ctx.matterId }),
          ...(ctx.proceedingId == null ? {} : { proceedingId: ctx.proceedingId }),
          description: d.text.slice(0, 2000),
          dueDate: d.dueDate,
          basis: (d.dueExpression ?? d.anchor.quote).slice(0, 500),
        },
        anchors: [idOf(d.anchor)],
        patternKey: d.derived === true ? 'order:direction_derived' : 'order:direction_literal',
        ...(demoted ? { ambiguous: true } : {}),
      });
    } else {
      // Undated: a task, the one kind the matrix lets through unasked (>= 0.8).
      drafts.push({
        ...base,
        kind: 'task',
        payload: {
          title: d.text.slice(0, 500),
          ...(ctx.matterId == null ? {} : { matterId: ctx.matterId }),
          ...(ctx.proceedingId == null ? {} : { proceedingId: ctx.proceedingId }),
        },
        anchors: [idOf(d.anchor)],
        patternKey: 'order:direction_undated',
        ...(demoted ? { ambiguous: true } : {}),
      });
    }
  }

  for (const cue of extraction.stageCues) {
    // The strict `listing_update` payload has no stage field: the cue travels as the anchored
    // quote, and a draft the handler cannot validate is shown as a card, never applied.
    drafts.push({
      ...base,
      kind: 'listing_update',
      payload: ctx.listingId == null ? {} : { listingId: ctx.listingId },
      anchors: [idOf(cue.anchor)],
      patternKey: 'order:stage_cue',
      ...(demoted ? { ambiguous: true } : {}),
    });
  }
  return drafts;
}
