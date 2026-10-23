// Hearing note -> automation drafts (#541). Pure: it turns a validated reading and a matter match
// into `ProposalDraft`s and decides nothing about levels (the engine's matrix does). Kinds:
// `hearing_outcome` (L2), `next_date` (L2, never applied unasked; a clash with a confirmed date
// becomes a conflict card in the engine), `obligation_from_direction` (only for a direction with a
// parsed due date) and `task` (undated; the matrix lets it through unasked at confidence >= 0.8).
// Every draft carries the anchors of the transcript spans it rests on. Payloads of kinds with a
// strict handler hold only the handler's fields; the candidate matters of an unmatched note ride
// on the `hearing_outcome` payload and the other drafts are marked `ambiguous`.
import type { ProposalDraft } from '@causedeck/validators/proposal-draft';

import type { MatchResult } from './match-matter.ts';
import type { Span, ValidatedHearing } from './schema.ts';

export interface HearingDraftContext {
  captureId: string;
  /** `YYYY-MM-DD`. */
  hearingDate: string;
  structured: ValidatedHearing;
  match: MatchResult;
  /** The model's 0-1 confidence in the structuring. */
  confidence: number;
  /** The anchor id of a transcript span (the capture stores one per span it cites). */
  anchorFor: (span: Span) => string;
  /** The `ai_call` behind the structuring. */
  aiCallId?: string | undefined;
  /** An opaque reference to the recording; never its content. */
  ref?: string | undefined;
}

const unique = (ids: string[]): string[] => [...new Set(ids)];

export function hearingToProposalDrafts(ctx: HearingDraftContext): ProposalDraft[] {
  const { structured, match, captureId, hearingDate } = ctx;
  const target = match.matched;
  const candidates = target === null ? match.candidates.map((c) => c.matterId) : [];
  const base = {
    captureId,
    source: {
      type: 'ai' as const,
      input: 'voice',
      ...(ctx.aiCallId === undefined ? {} : { aiCallId: ctx.aiCallId }),
      ...(ctx.ref === undefined ? {} : { ref: ctx.ref }),
    },
    confidence: ctx.confidence,
    ...(target === null
      ? candidates.length > 0
        ? { ambiguous: true }
        : {}
      : {
          matterId: target.matterId,
          ...(target.proceedingId === undefined ? {} : { proceedingId: target.proceedingId }),
          match: { score: target.score, exact: target.exact },
        }),
  };
  const anchors = (...spans: (Span | undefined)[]): string[] =>
    unique(spans.flatMap((span) => (span === undefined ? [] : [ctx.anchorFor(span)])));
  const withCandidates = target === null && candidates.length > 0 ? { candidates } : {};
  const drafts: ProposalDraft[] = [];

  if (structured.outcome !== undefined) {
    drafts.push({
      ...base,
      kind: 'hearing_outcome',
      patternKey: 'voice:hearing_outcome',
      anchors: anchors(
        structured.outcome.span,
        structured.adjournmentReason?.span,
        structured.stageAfter?.span,
        structured.matterRef?.span,
      ),
      payload: {
        hearingDate,
        outcome: structured.outcome.text,
        ...(structured.adjournmentReason === undefined
          ? {}
          : { adjournmentReason: structured.adjournmentReason.text }),
        ...(structured.stageAfter === undefined ? {} : { stageAfter: structured.stageAfter.text }),
        ...(structured.matterRef === undefined ? {} : { matterRef: structured.matterRef.text }),
        ...withCandidates,
      },
    });
  }
  if (structured.nextDate !== undefined) {
    drafts.push({
      ...base,
      kind: 'next_date',
      patternKey: 'voice:next_date',
      anchors: anchors(structured.nextDate.span),
      payload: {
        date: structured.nextDate.date,
        ...(target?.proceedingId === undefined ? {} : { proceedingId: target.proceedingId }),
      },
    });
  }
  for (const direction of structured.directions) {
    if (direction.dueDate === undefined) continue;
    drafts.push({
      ...base,
      kind: 'obligation_from_direction',
      patternKey: 'voice:obligation_from_direction',
      anchors: anchors(direction.span),
      payload: {
        description: direction.text,
        dueDate: direction.dueDate,
        ...(direction.dueExpression === undefined ? {} : { basis: direction.dueExpression }),
        ...(target === null ? {} : { matterId: target.matterId }),
      },
    });
  }
  for (const task of structured.tasks) {
    drafts.push({
      ...base,
      kind: 'task',
      patternKey: 'voice:task',
      anchors: anchors(task.span),
      payload: { title: task.title },
    });
  }
  return drafts;
}
