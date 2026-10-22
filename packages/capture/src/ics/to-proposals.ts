// Calendar event -> automation draft (#53). Pure: the importer (core `calendar` domain) finds the
// proceeding and its confirmed next date, and this decides what the event means. A calendar event
// never confirms anything: it becomes a `next_date` draft (the engine stages a proposal, or a
// conflict card when it differs from a confirmed date) or, for an event that agrees with the
// confirmed date and names an item number, a `listing_update`. Unmatched events never become drafts.
import type { ProposalDraft } from '@causedeck/validators/proposal-draft';

import type { IcsEvent } from './parse.ts';

export interface MatchedTarget {
  proceedingId: string;
  matterId: string;
  /** The proceeding's confirmed canonical next date (`YYYY-MM-DD`), if it has one. */
  confirmedDate: string | null;
  confirmedListingId: string | null;
}

export type EventOutcome =
  | { kind: 'draft'; draft: ProposalDraft }
  | { kind: 'unchanged' }
  | { kind: 'ignored'; reason: 'cancelled' | 'past' };

export interface DraftContext {
  captureId: string;
  /** Today in IST, `YYYY-MM-DD`: earlier dates are not proposed. */
  today: string;
  anchorIds: readonly string[];
  score: number;
}

const ITEM_NO = /\bitem\s*(?:no\.?)?\s*(\d{1,4}[A-Za-z]?)\b/i;

/** The item number named in the event text, if any. */
export function itemNoOf(event: Pick<IcsEvent, 'summary' | 'description'>): string | null {
  const match = ITEM_NO.exec(`${event.summary} ${event.description}`);
  return match?.[1] ?? null;
}

export function eventToDraft(
  event: IcsEvent,
  target: MatchedTarget,
  ctx: DraftContext,
): EventOutcome {
  if (event.status === 'cancelled') return { kind: 'ignored', reason: 'cancelled' };
  const base = {
    captureId: ctx.captureId,
    source: { type: 'deterministic', input: 'calendar', ref: event.uid } as const,
    anchors: [...ctx.anchorIds],
    confidence: ctx.score,
    matterId: target.matterId,
    proceedingId: target.proceedingId,
    patternKey: 'calendar:next_date',
  };
  const itemNo = itemNoOf(event);
  if (target.confirmedDate === event.date) {
    if (target.confirmedListingId === null || itemNo === null) return { kind: 'unchanged' };
    return {
      kind: 'draft',
      draft: {
        ...base,
        kind: 'listing_update',
        patternKey: 'calendar:listing_update',
        payload: { listingId: target.confirmedListingId, itemNo },
      },
    };
  }
  if (event.date < ctx.today) return { kind: 'ignored', reason: 'past' };
  return {
    kind: 'draft',
    draft: {
      ...base,
      kind: 'next_date',
      payload: {
        proceedingId: target.proceedingId,
        date: event.date,
        ...(itemNo === null ? {} : { itemNo }),
      },
    },
  };
}
