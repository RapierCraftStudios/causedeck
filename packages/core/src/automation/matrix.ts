// The approval-boundary matrix (#47; docs/product/09 §4.2) as data: for each kind of change, the
// level it starts at and the condition under which it may be applied without asking (L3). Anything
// date-critical, financial or identity-defining is always a proposal (TR-2); client, senior and
// third-party messages are L4 drafts that only a lawyer sends. `decideLevel` is the only reader.
import type { ParsedProposalDraft, ProposalKind } from '@causedeck/validators/proposal-draft';

import type { AutomationLevel } from './levels.ts';

/** What the matrix may consult besides the draft. */
export interface DecideContext {
  /** Learned auto-apply thresholds, keyed `kind|patternKey` (see `thresholdKey`). */
  thresholds?: ReadonlyMap<string, number>;
  /** Kinds this user wants to be asked about first (`automation_preference.ask_first`). */
  askFirst?: ReadonlySet<ProposalKind>;
}

export interface MatrixRule {
  /** The level when the L3 gate is absent or fails. */
  defaultLevel: AutomationLevel;
  /** When present and true, the draft may be applied without asking (L3). */
  l3Gate?: (draft: ParsedProposalDraft) => boolean;
  /** The least confidence an L3 draft needs; learned thresholds only ever raise it. */
  baseThreshold?: number;
  reason: string;
}

/** The match score an input needs before it may be attached to an existing matter unasked. */
export const MATCH_L3_SCORE = 0.9;
/** The confidence an undated task needs before it is created unasked. */
export const TASK_L3_CONFIDENCE = 0.8;
/** The starting threshold of a kind with no base, when its first undo creates a learned one. */
export const DEFAULT_LEARNED_BASE = 0.8;

/** An exact case-number or CNR match with a score of at least 0.9 (the "L3 match"). */
export function isL3Match(draft: ParsedProposalDraft): boolean {
  const match = draft.match;
  return match != null && match.score >= MATCH_L3_SCORE && match.exact != null;
}

const present = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

export const APPROVAL_MATRIX: Readonly<Record<ProposalKind, MatrixRule>> = {
  next_date: {
    defaultLevel: 'L2',
    reason:
      'A next date is date-critical: always a proposal; a confirmed date is never overwritten',
  },
  hearing_outcome: {
    defaultLevel: 'L2',
    reason: 'What happened at a hearing is a legal fact read from speech: always a proposal',
  },
  obligation_from_direction: {
    defaultLevel: 'L2',
    reason: 'Compliance and limitation dates are date-critical: always a proposal',
  },
  new_matter: { defaultLevel: 'L2', reason: 'A new matter defines identity: always a proposal' },
  new_proceeding: {
    defaultLevel: 'L2',
    reason: 'A new proceeding defines identity: always a proposal',
  },
  order_record: { defaultLevel: 'L2', reason: 'Recording an order is a legal fact: a proposal' },
  document_attach: {
    defaultLevel: 'L2',
    l3Gate: isL3Match,
    reason: 'Attach unasked only to a matter matched by case number or CNR at score >= 0.9',
  },
  listing_update: {
    defaultLevel: 'L2',
    l3Gate: (draft) => draft.match?.exact === 'case_number',
    reason: 'Item number, courtroom and bench from a list: unasked only on an exact case number',
  },
  task: {
    defaultLevel: 'L2',
    l3Gate: (draft) => !present(draft.payload['dueDate']),
    baseThreshold: TASK_L3_CONFIDENCE,
    reason: 'An undated task is unasked at confidence >= 0.8; a dated task is a proposal',
  },
  party_detail: {
    defaultLevel: 'L2',
    l3Gate: (draft) => present(draft.payload['personId']) && present(draft.payload['contact']),
    reason: 'A phone or email on a known party is unasked; a new person is a proposal',
  },
  duplicate_merge: {
    defaultLevel: 'L2',
    l3Gate: (draft) => draft.duplicate != null,
    reason: 'A duplicate capture merges unasked, with undo; an unconfirmed duplicate is a proposal',
  },
  fee_entry: { defaultLevel: 'L2', reason: 'Money is always a proposal' },
  memory_item: { defaultLevel: 'L2', reason: 'Memory is saved only after the lawyer confirms' },
  case_status_change: {
    defaultLevel: 'L2',
    reason: 'A next date read from a court status page is date-critical: always a proposal',
  },
  outward_draft: {
    defaultLevel: 'L4',
    reason:
      'Client, senior and third-party messages are drafts a lawyer sends; the engine never sends',
  },
};
