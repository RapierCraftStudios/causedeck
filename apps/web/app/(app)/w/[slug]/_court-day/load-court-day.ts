// The board's read side (#59): `getCourtDay` plus the clashes derived from it. IST day arithmetic
// lives here so `/today` and `/tomorrow` agree on what a day is.
import type { Clash, CourtDay, ListDiff } from '@causedeck/validators';

import { can, type Role } from '../../../../../lib/workspace-context.ts';

const istDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

/** `YYYY-MM-DD` in IST, `offsetDays` after `now`. */
export function istDate(now: Date, offsetDays = 0): string {
  return istDay.format(new Date(now.getTime() + offsetDays * 86_400_000));
}

/** A hall whose list could not be read: the board keeps the last known data and says so. */
export interface HallFailure {
  /** The hall number the adapter could not read. */
  hallNo: string;
  forum: string;
  /** When the data on screen was read. */
  readAt: Date | null;
  /** The forum's official cause-list page, opened in a new window; null when it has none. */
  officialUrl: string | null;
}

export interface BoardData {
  day: CourtDay;
  clashes: Clash[];
  /** The latest list change of each forum on the day (`getListDiffs`). */
  diffs: ListDiff[];
  failures: HallFailure[];
}

/** Clashes among the day's listed items: one member, one date, different halls or complexes. */
export async function clashesOf(day: CourtDay): Promise<Clash[]> {
  const { detectClashes } = await import('@causedeck/core/court-day');
  return detectClashes(
    day.complexes.flatMap((complex) =>
      complex.halls.flatMap((hall) =>
        hall.lists.flatMap((list) =>
          list.items.map((item) => ({
            listingId: item.listingId,
            proceedingId: item.proceedingId,
            forumId: complex.forumId,
            hallId: item.hallId,
            itemNo: item.itemNo,
            listDate: day.date,
            memberIds: item.appearingMemberIds,
          })),
        ),
      ),
    ),
  );
}

/** The parse-run facts of one forum that the failure banner needs (`getCourtsIndex`). */
export interface ForumParse {
  id: string;
  latestParse: { status: string; at: Date; hallsUnreadable: string[] } | null;
  officialList: { url: string } | null;
}

/**
 * The halls the newest list read could not read, for the forums the day has items in. A run applies
 * to the day it was made for or the day after it (the evening list is for tomorrow); the data on
 * screen stays and is labelled with when it was read.
 */
export function failuresOf(day: CourtDay, forums: readonly ForumParse[]): HallFailure[] {
  return day.complexes.flatMap((complex) => {
    const found = forums.find((f) => f.id === complex.forumId);
    const run = found?.latestParse;
    if (found === undefined || !run || run.status === 'ok') return [];
    const runDay = istDate(run.at);
    if (runDay !== day.date && istDate(run.at, 1) !== day.date) return [];
    return run.hallsUnreadable.map((hallNo) => ({
      hallNo,
      forum: complex.name,
      readAt: day.freshness ?? run.at,
      officialUrl: found.officialList?.url ?? null,
    }));
  });
}

/**
 * A member who cannot see the whole workspace is shown only the diff entries of their own items: a
 * stored list holds every case of the forum.
 */
export function scopeDiffs(diffs: readonly ListDiff[], day: CourtDay): ListDiff[] {
  const keys = new Set(
    day.complexes.flatMap((c) =>
      c.halls.flatMap((h) =>
        h.lists.flatMap((l) => l.items.flatMap((i) => [i.proceedingId, i.caseLabel])),
      ),
    ),
  );
  const keep = (entries: ListDiff['added']) => entries.filter((e) => keys.has(e.proceedingKey));
  return diffs
    .map((d) => ({
      label: d.label,
      added: keep(d.added),
      removed: keep(d.removed),
      moved: keep(d.moved),
      stage_changed: keep(d.stage_changed),
      entries: keep(d.entries),
    }))
    .filter((d) => d.entries.length > 0);
}

/** Load one day for a member. Throws on a failed read so the route's error boundary shows. */
export async function loadBoard(input: {
  workspaceId: string;
  userId: string;
  role: Role;
  date: string;
}): Promise<BoardData> {
  const { db, inWorkspace } = await import('@causedeck/core/runtime');
  const { getCourtDay, getListDiffs } = await import('@causedeck/core/court-day');
  const all = can(input.role, 'court_day.view_all');
  const actor = { workspaceId: input.workspaceId, userId: input.userId };
  const day = await getCourtDay({ db }, actor, {
    date: input.date,
    scope: all ? 'workspace' : 'mine',
  });
  const stored = await getListDiffs({ db }, actor, { date: input.date });
  const diffs = all ? stored : scopeDiffs(stored, day);
  // A failed parse-health read must not take the board down: the day is still readable.
  let failures: HallFailure[] = [];
  try {
    const { getCourtsIndex } = await import('@causedeck/core/court');
    const index = await inWorkspace(actor, (tx) => getCourtsIndex(tx, input.workspaceId));
    const forums = index.cities.flatMap((city) => city.courts.flatMap((court) => court.forums));
    failures = failuresOf(day, forums);
  } catch {
    failures = [];
  }
  return { day, clashes: await clashesOf(day), diffs, failures };
}
