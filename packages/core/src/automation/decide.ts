// `decideLevel` (#47): the one function that decides whether the system may act on a draft. It reads
// the approval matrix (matrix.ts), then lowers an L3 result to L2 when the draft is not trustworthy
// enough (low confidence, unanchored AI output, ambiguity), when the learned threshold for its
// kind and pattern has not been met, or when the user asked to be asked first. It never raises a level.
import type { ParsedProposalDraft, ProposalKind } from '@causedeck/validators/proposal-draft';

import type { AutomationLevel } from './levels.ts';
import { APPROVAL_MATRIX, type DecideContext } from './matrix.ts';

/** Below this confidence a draft is always a card for the person ("Needs you"). */
export const NEEDS_YOU_CONFIDENCE = 0.5;

export type DowngradeReason = 'needs_you' | 'gate' | 'threshold' | 'ask_first';

export interface Decision {
  level: AutomationLevel;
  /** Why the draft landed at `level`. */
  reason: string;
  /** Set when an L3 result was lowered, and by what. */
  downgradedBy: DowngradeReason | null;
  /** Set when the draft must be surfaced as a "Needs you" card, with why. */
  needsYou: string | null;
}

/** The key learned thresholds are stored and looked up by. */
export function thresholdKey(kind: ProposalKind, patternKey: string): string {
  return `${kind}|${patternKey}`;
}

/** The pattern a draft's threshold is learned for. */
export function patternOf(draft: Pick<ParsedProposalDraft, 'kind' | 'patternKey'>): string {
  return draft.patternKey ?? draft.kind;
}

/** Why a draft must be a "Needs you" card whatever its kind, or null. */
export function needsYouReason(draft: ParsedProposalDraft): string | null {
  if (draft.ambiguous === true) return 'ambiguous: more than one candidate';
  if (draft.confidence != null && draft.confidence < NEEDS_YOU_CONFIDENCE) {
    return 'low confidence';
  }
  if (draft.source.type === 'ai' && draft.anchors.length === 0) {
    return 'unanchored: no evidence in the source';
  }
  return null;
}

/** The confidence an L3 draft of this kind and pattern needs, or null when none is required. */
export function requiredConfidence(draft: ParsedProposalDraft, ctx: DecideContext): number | null {
  const base = APPROVAL_MATRIX[draft.kind].baseThreshold;
  const learned = ctx.thresholds?.get(thresholdKey(draft.kind, patternOf(draft)));
  if (base === undefined && learned === undefined) return null;
  return Math.max(base ?? 0, learned ?? 0);
}

export function decideLevel(draft: ParsedProposalDraft, ctx: DecideContext = {}): Decision {
  const rule = APPROVAL_MATRIX[draft.kind];
  const needsYou = needsYouReason(draft);
  const gated = rule.l3Gate?.(draft) === true;
  if (!gated) {
    return { level: rule.defaultLevel, reason: rule.reason, downgradedBy: null, needsYou };
  }
  // The gate opened: L3 unless something below lowers it.
  const lowered = (downgradedBy: DowngradeReason, reason: string): Decision => ({
    level: 'L2',
    reason,
    downgradedBy,
    needsYou,
  });
  if (needsYou !== null) return lowered('needs_you', `Needs you: ${needsYou}`);
  const required = requiredConfidence(draft, ctx);
  if (required !== null && (draft.confidence == null || draft.confidence < required)) {
    return lowered('threshold', `Confidence is below the ${required.toFixed(2)} threshold`);
  }
  if (ctx.askFirst?.has(draft.kind) === true) {
    return lowered('ask_first', 'This user asked to be asked first for this kind');
  }
  return { level: 'L3', reason: rule.reason, downgradedBy: null, needsYou: null };
}
