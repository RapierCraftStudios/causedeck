// The private feed builder (#53; PRD CA-5; docs/product/09 §3, §8). Pure: the core `calendar`
// domain loads the rows the feed owner may see and the feed's previous state; this renders the
// calendar. One all-day VEVENT per confirmed canonical listing (`listing-{id}@causedeck`) and per
// open obligation due date (`obligation-{id}@causedeck`). The content is minimal because calendar
// providers fetch the URL on servers outside India: no party names unless the feed asks for them, a
// deep link that needs sign-in, nothing from sensitive matters, and nothing unconfirmed.
import { createHash } from 'node:crypto';

import { vcalendar, vevent } from './serialize.ts';

/** A removed date stays in the feed as CANCELLED for this long. */
export const CANCELLED_KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface FeedListing {
  id: string;
  matterId: string;
  /** `YYYY-MM-DD`. */
  listDate: string;
  itemNo: string | null;
  /** `W.P. 12345/2026`. */
  caseLabel: string;
  /** The hall as printed (`Court 12`), if known. */
  hall: string | null;
  forum: string | null;
  confirmationState: string;
  sensitive: boolean;
  /** Party names for `includeParties` feeds. */
  parties: string | null;
}

export interface FeedObligation {
  id: string;
  matterId: string;
  dueDate: string;
  description: string;
  caseLabel: string | null;
  status: string;
  sensitive: boolean;
  parties: string | null;
}

export interface FeedOptions {
  includeParties: boolean;
  /** `https://app.example.com/w/<slug>`: the deep link base (signing in is required). */
  workspaceUrl: string;
  name: string;
}

/** What the feed remembers about one UID between fetches (table `ics_feed_event`). */
export interface FeedState {
  uid: string;
  sequence: number;
  contentHash: string;
  /** When the content last changed (the event's DTSTAMP). */
  changedAt: Date;
  cancelledAt: Date | null;
  snapshot: FeedSnapshot;
}

export interface FeedSnapshot {
  date: string;
  summary: string;
  location: string | null;
  description: string | null;
}

export interface BuiltFeed {
  body: string;
  /** Quoted strong ETag. */
  etag: string;
  /** Every state row to keep (current and still-cancelled UIDs); others are dropped. */
  nextState: FeedState[];
  eventCount: number;
}

export const listingUid = (id: string): string => `listing-${id}@causedeck`;
export const obligationUid = (id: string): string => `obligation-${id}@causedeck`;

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

function listingSnapshot(row: FeedListing, options: FeedOptions): FeedSnapshot {
  const detail = [row.hall, row.itemNo === null ? null : `Item ${row.itemNo}`].filter(
    (part): part is string => part !== null && part !== '',
  );
  const summary = `Hearing: ${row.caseLabel}${detail.length > 0 ? ` (${detail.join(', ')})` : ''}`;
  const parties = options.includeParties && row.parties ? `${row.parties}\n` : '';
  return {
    date: row.listDate,
    summary,
    location:
      [row.forum, row.hall].filter((p): p is string => p !== null && p !== '').join(', ') || null,
    description: `${parties}Open in CauseDeck (sign-in required): ${options.workspaceUrl}/matters/${row.matterId}`,
  };
}

function obligationSnapshot(row: FeedObligation, options: FeedOptions): FeedSnapshot {
  const label = row.caseLabel === null ? 'Deadline' : `Deadline: ${row.caseLabel}`;
  const summary = options.includeParties ? `${label} - ${row.description.slice(0, 80)}` : label;
  const parties = options.includeParties && row.parties ? `${row.parties}\n` : '';
  return {
    date: row.dueDate,
    summary,
    location: null,
    description: `${parties}Open in CauseDeck (sign-in required): ${options.workspaceUrl}/matters/${row.matterId}`,
  };
}

/**
 * Render the feed. `previous` is the stored state for this feed. Rows that are not confirmed, are
 * closed or belong to a sensitive matter are dropped here too, so a caller bug cannot publish them.
 */
export function buildFeed(
  listings: readonly FeedListing[],
  obligations: readonly FeedObligation[],
  previous: readonly FeedState[],
  options: FeedOptions,
  now: Date,
): BuiltFeed {
  const before = new Map(previous.map((s) => [s.uid, s]));
  const current = new Map<string, FeedSnapshot>();
  for (const row of listings) {
    if (row.sensitive || row.confirmationState === 'proposed') continue;
    current.set(listingUid(row.id), listingSnapshot(row, options));
  }
  for (const row of obligations) {
    if (row.sensitive || row.status !== 'open') continue;
    current.set(obligationUid(row.id), obligationSnapshot(row, options));
  }

  const next: FeedState[] = [];
  for (const [uid, snapshot] of current) {
    const contentHash = sha(JSON.stringify(snapshot));
    const old = before.get(uid);
    if (old === undefined) {
      next.push({ uid, sequence: 0, contentHash, changedAt: now, cancelledAt: null, snapshot });
    } else if (old.contentHash === contentHash && old.cancelledAt === null) {
      next.push({ ...old, snapshot });
    } else {
      next.push({
        uid,
        sequence: old.sequence + 1,
        contentHash,
        changedAt: now,
        cancelledAt: null,
        snapshot,
      });
    }
  }
  for (const old of before.values()) {
    if (current.has(old.uid)) continue;
    if (old.cancelledAt === null) {
      next.push({ ...old, sequence: old.sequence + 1, changedAt: now, cancelledAt: now });
    } else if (now.getTime() - old.cancelledAt.getTime() < CANCELLED_KEEP_DAYS * DAY_MS) {
      next.push(old);
    }
  }

  next.sort((a, b) => a.snapshot.date.localeCompare(b.snapshot.date) || a.uid.localeCompare(b.uid));
  const events = next.map((state) =>
    vevent({
      uid: state.uid,
      dtstamp: state.changedAt,
      sequence: state.sequence,
      date: state.snapshot.date,
      summary: state.snapshot.summary,
      location: state.snapshot.location,
      description: state.snapshot.description,
      cancelled: state.cancelledAt !== null,
    }),
  );
  const body = vcalendar(options.name, events);
  return { body, etag: `"${sha(body)}"`, nextState: next, eventCount: events.length };
}
