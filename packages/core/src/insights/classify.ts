// What an obligation's state means for the practice report (#85), pure so the definitions are
// tested on fixtures. A deliberate reschedule (an `obligation_event` of kind `rescheduled`, which
// always carries a reason) is never a miss.
export type ObligationOutcome =
  /** Owned, dated and done. */
  | 'kept'
  /** Closed as not applicable or superseded: a deliberate decision, neither kept nor missed. */
  | 'resolved'
  /** Open and moved on purpose, with its reason. */
  | 'rescheduled'
  /** Open, owned and not yet overdue. */
  | 'pending'
  /** Open and overdue, never deliberately rescheduled. */
  | 'missed'
  /** No owner, or open without a due date: not captured properly. */
  | 'uncaptured';

export interface ObligationFacts {
  status: 'open' | 'done' | 'not_applicable' | 'superseded';
  ownerMemberId: string | null;
  /** `YYYY-MM-DD`. */
  dueDate: string | null;
  /** How many times it was deliberately rescheduled. */
  reschedules: number;
}

/** The outcome of one obligation on the IST day `today`. */
export function classifyObligation(facts: ObligationFacts, today: string): ObligationOutcome {
  if (facts.status === 'not_applicable' || facts.status === 'superseded') return 'resolved';
  if (facts.ownerMemberId === null) return 'uncaptured';
  if (facts.status === 'done') return 'kept';
  if (facts.dueDate === null) return 'uncaptured';
  if (facts.reschedules > 0) return 'rescheduled';
  return facts.dueDate < today ? 'missed' : 'pending';
}

export type AppearanceOutcome = 'kept' | 'not_kept' | 'pending';

/**
 * Prepared and kept: a current brief was confirmed before the hearing AND every obligation arising
 * from it is captured, owned and kept or deliberately rescheduled. A hearing with no obligations
 * depends on the brief alone. While some obligation is still pending (and none has failed) the
 * appearance is undecided.
 */
export function classifyAppearance(
  briefConfirmedBeforeHearing: boolean,
  obligations: readonly ObligationOutcome[],
): AppearanceOutcome {
  if (!briefConfirmedBeforeHearing) return 'not_kept';
  if (obligations.some((o) => o === 'missed' || o === 'uncaptured')) return 'not_kept';
  if (obligations.some((o) => o === 'pending')) return 'pending';
  return 'kept';
}

/** `numerator / denominator`, or null for an empty denominator; four decimals. */
export function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10000) / 10000;
}
