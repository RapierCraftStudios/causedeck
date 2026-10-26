// The stale-matter rules (#70): pure functions over a matter's loaded facts. Each returns zero or
// more hits with the rule, the evidence in words, the day the condition has held since and a
// suggested action as text. Nothing here reads or writes the database, and a suggestion never runs
// by itself. The clerk form of the evidence is date-only (no stage or obligation wording).
import type { AttentionAction, AttentionRule } from '@causedeck/validators/attention';

import { addDays, daysBetween } from '../obligations/index.ts';

/** Days after a listing's date a hearing outcome may still be recorded before the listing is flagged. */
export const HEARING_WINDOW_DAYS = 2;

export interface ProceedingFact {
  id: string;
  state: string;
}

export interface ListingFact {
  id: string;
  proceedingId: string;
  listDate: string;
  stageRaw: string;
  /** A hearing with a confirmed outcome or a confirmed next date exists for the listing. */
  hasOutcome: boolean;
}

export interface ObligationFact {
  id: string;
  dueDate: string | null;
  ownerMemberId: string | null;
}

export interface MatterFacts {
  matterId: string;
  title: string;
  /** The latest event (order, hearing, obligation change, matter edit), or null when none. */
  lastEventAt: Date | null;
  openedAt: Date;
  /** Proceedings of the matter; a disposed one is not live. */
  proceedings: ProceedingFact[];
  /** Confirmed upcoming dates (listing dates and confirmed next dates) on or after today. */
  upcomingDates: string[];
  listings: ListingFact[];
  /** Open obligations only. */
  obligations: ObligationFact[];
}

export interface RuleContext {
  /** The workspace's local day, `YYYY-MM-DD`. */
  today: string;
  /** The workspace threshold in days (`attention_stale_days`). */
  staleDays: number;
}

export interface RuleHit {
  rule: AttentionRule;
  subjectId: string | null;
  since: string;
  evidence: string;
  /** Date-only wording for roles that may not see strategy-bearing text. */
  redactedEvidence: string;
  suggestedAction: string;
  actionKind: AttentionAction;
}

const dayOf = (at: Date): string => at.toISOString().slice(0, 10);

/** The day of the matter's last event, or the day it was opened. */
export function lastEventDay(facts: MatterFacts): string {
  const at = facts.lastEventAt ?? facts.openedAt;
  return dayOf(at.getTime() > facts.openedAt.getTime() ? at : facts.openedAt);
}

const liveProceedings = (facts: MatterFacts): ProceedingFact[] =>
  facts.proceedings.filter((p) => p.state !== 'disposed');

/** A live proceeding and no confirmed next date. */
export function noNextDate(facts: MatterFacts): RuleHit[] {
  if (liveProceedings(facts).length === 0 || facts.upcomingDates.length > 0) return [];
  const since = lastEventDay(facts);
  const evidence = `No next date since ${since}`;
  return [
    {
      rule: 'no_next_date',
      subjectId: null,
      since,
      evidence,
      redactedEvidence: evidence,
      suggestedAction: 'Set the next date',
      actionKind: 'set_next_date',
    },
  ];
}

/** The latest past listing of each live proceeding that has no confirmed outcome after the window. */
export function pastDateNoOutcome(facts: MatterFacts, ctx: RuleContext): RuleHit[] {
  const live = new Set(liveProceedings(facts).map((p) => p.id));
  const latest = new Map<string, ListingFact>();
  for (const listing of facts.listings) {
    if (!live.has(listing.proceedingId) || listing.listDate > ctx.today) continue;
    const seen = latest.get(listing.proceedingId);
    if (seen === undefined || listing.listDate > seen.listDate) latest.set(listing.proceedingId, listing);
  }
  const hits: RuleHit[] = [];
  for (const listing of latest.values()) {
    if (listing.hasOutcome || ctx.today <= addDays(listing.listDate, HEARING_WINDOW_DAYS)) continue;
    const label = listing.stageRaw.trim();
    hits.push({
      rule: 'past_date_no_outcome',
      subjectId: listing.id,
      since: listing.listDate,
      evidence:
        label === ''
          ? `Listing of ${listing.listDate} has no recorded outcome`
          : `Listing "${label}" of ${listing.listDate} has no recorded outcome`,
      redactedEvidence: `Listing of ${listing.listDate} has no recorded outcome`,
      suggestedAction: 'Record the outcome',
      actionKind: 'record_outcome',
    });
  }
  return hits;
}

/** No event in the last `staleDays` days. */
export function noRecentUpdate(facts: MatterFacts, ctx: RuleContext): RuleHit[] {
  const since = lastEventDay(facts);
  const idle = daysBetween(since, ctx.today);
  if (idle <= ctx.staleDays) return [];
  const evidence = `No update in ${String(idle)} days (since ${since})`;
  return [
    {
      rule: 'no_recent_update',
      subjectId: null,
      since,
      evidence,
      redactedEvidence: evidence,
      suggestedAction: 'Ask the junior for an update',
      actionKind: 'ask_junior',
    },
  ];
}

/** An open obligation past its due date with no owner. */
export function obligationOverdueUnowned(facts: MatterFacts, ctx: RuleContext): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const o of facts.obligations) {
    if (o.ownerMemberId !== null || o.dueDate === null || o.dueDate >= ctx.today) continue;
    const evidence = `Obligation due ${o.dueDate} is overdue and has no owner`;
    hits.push({
      rule: 'obligation_overdue_unowned',
      subjectId: o.id,
      since: o.dueDate,
      evidence,
      redactedEvidence: evidence,
      suggestedAction: 'Ask the junior to take the obligation',
      actionKind: 'ask_junior',
    });
  }
  return hits;
}

/** Every rule over one matter's facts. */
export function evaluateRules(facts: MatterFacts, ctx: RuleContext): RuleHit[] {
  return [
    ...noNextDate(facts),
    ...pastDateNoOutcome(facts, ctx),
    ...noRecentUpdate(facts, ctx),
    ...obligationOverdueUnowned(facts, ctx),
  ];
}
