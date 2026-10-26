// Court-day reminder builders (#64, ADR 0039). Pure: they take the court day, the readiness scores
// and the hearing rows the job already read, and return counts and ids. The evening brief and the
// morning diff are `null` when there is nothing to say, so a court holiday with no listings sends
// nothing. `EveningBrief.names` is for the in-app body only; `eveningPushPayload` and the other
// push payloads carry counts and never a name. Readiness scores come from `briefs` (which imports
// this domain), so the caller passes them in.
import type { CourtDay, ListDiff } from '@causedeck/validators';

import { detectClashes, type ClashCandidate } from './clashes.ts';

/** A brief below this readiness score is named in the evening brief. */
export const LOW_READINESS_BELOW = 60;
/** The outcome-missing nudge for a hall with no marker is due at this local time. */
export const OUTCOME_FALLBACK_TIME = '16:30';

const DAY_MS = 86_400_000;

/** `date` (`YYYY-MM-DD`) moved by `days` calendar days. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export interface EveningBrief {
  listings: number;
  halls: number;
  clashes: number;
  lowReadiness: number;
  obligations: number;
  /** Matter titles: shown in-app only, never in a push. */
  names: string[];
}

export interface EveningBriefInput {
  day: CourtDay;
  /** `computeReadiness(brief).score` by listing id; a listing with no score counts as ready. */
  readiness: ReadonlyMap<string, number>;
  /** Open obligations due on the day, owned by the member. */
  obligationsDue: number;
}

/** The evening brief for the day, or `null` when nothing is listed (a holiday or an empty day). */
export function buildEveningBrief(input: EveningBriefInput): EveningBrief | null {
  const candidates: ClashCandidate[] = [];
  const halls = new Set<string>();
  const listings = new Set<string>();
  const names: string[] = [];
  for (const complex of input.day.complexes) {
    for (const hall of complex.halls) {
      for (const list of hall.lists) {
        for (const item of list.items) {
          if (listings.has(item.listingId)) continue;
          listings.add(item.listingId);
          halls.add(`${complex.forumId}:${hall.hallId ?? hall.hallNo ?? ''}`);
          if (!names.includes(item.matterTitle)) names.push(item.matterTitle);
          candidates.push({
            listingId: item.listingId,
            proceedingId: item.proceedingId,
            forumId: complex.forumId,
            hallId: item.hallId,
            itemNo: item.itemNo,
            listDate: input.day.date,
            memberIds: item.appearingMemberIds,
          });
        }
      }
    }
  }
  if (listings.size === 0) return null;
  let lowReadiness = 0;
  for (const id of listings) {
    const score = input.readiness.get(id);
    if (score !== undefined && score < LOW_READINESS_BELOW) lowReadiness += 1;
  }
  return {
    listings: listings.size,
    halls: halls.size,
    clashes: detectClashes(candidates).length,
    lowReadiness,
    obligations: input.obligationsDue,
    names,
  };
}

/** What a push may carry: counts and a link, no name. */
export type EveningPushPayload = Omit<EveningBrief, 'names'> & { href: '/tomorrow' };

export function eveningPushPayload(brief: EveningBrief): EveningPushPayload {
  return {
    listings: brief.listings,
    halls: brief.halls,
    clashes: brief.clashes,
    lowReadiness: brief.lowReadiness,
    obligations: brief.obligations,
    href: '/tomorrow',
  };
}

export interface MorningDiff {
  added: number;
  moved: number;
  removed: number;
}

/** The change summary over the day's list diffs, or `null` when no list changed. */
export function buildMorningDiff(diffs: readonly ListDiff[]): MorningDiff | null {
  const total: MorningDiff = { added: 0, moved: 0, removed: 0 };
  for (const diff of diffs) {
    total.added += diff.added.length;
    total.moved += diff.moved.length + diff.stage_changed.length;
    total.removed += diff.removed.length;
  }
  return total.added + total.moved + total.removed === 0 ? null : total;
}

export interface HearingForOutcome {
  hearingId: string;
  listingId: string;
  hallId: string | null;
  /** Null: no confirmed outcome. */
  outcome: string | null;
  appearances: readonly { memberId: string | null; capacity: string }[];
  matterOwnerMemberId: string | null;
}

export interface MissingOutcome {
  hearingId: string;
  listingId: string;
  /** The appearing members, plus the matter owner for a delegated appearance. */
  memberIds: string[];
}

export interface MissingOutcomeInput {
  hearings: readonly HearingForOutcome[];
  /** When the hall's list was last worked (`court_day_marker.set_at` at its last item), by hall. */
  lastItemAt: ReadonlyMap<string, Date>;
  /** Local midnight at the start of the court day. */
  dayStart: Date;
  now: Date;
  delayMinutes: number;
}

/** A proxy or a lawyer appearing for another is a delegated appearance: the owner is told too. */
const DELEGATED = new Set(['proxy', 'for_other']);

/**
 * Hearings past their due time with no confirmed outcome. The due time is `delayMinutes` after the
 * last item in the hall, or 16:30 local when the hall has no marker.
 */
export function findMissingOutcomes(input: MissingOutcomeInput): MissingOutcome[] {
  const [h = '16', m = '30'] = OUTCOME_FALLBACK_TIME.split(':');
  const fallback = input.dayStart.getTime() + (Number(h) * 60 + Number(m)) * 60_000;
  const found: MissingOutcome[] = [];
  for (const hearing of input.hearings) {
    if (hearing.outcome !== null) continue;
    const last = hearing.hallId === null ? undefined : input.lastItemAt.get(hearing.hallId);
    const due = last === undefined ? fallback : last.getTime() + input.delayMinutes * 60_000;
    if (input.now.getTime() < due) continue;
    const memberIds = new Set<string>();
    for (const a of hearing.appearances) {
      if (a.memberId === null) continue;
      memberIds.add(a.memberId);
      if (DELEGATED.has(a.capacity) && hearing.matterOwnerMemberId !== null) {
        memberIds.add(hearing.matterOwnerMemberId);
      }
    }
    if (memberIds.size === 0) continue;
    found.push({
      hearingId: hearing.hearingId,
      listingId: hearing.listingId,
      memberIds: [...memberIds].sort(),
    });
  }
  return found;
}
