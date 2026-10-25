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
  hallId: string;
  forum: string;
  readAt: Date | null;
  officialUrl: string | null;
}

export interface BoardData {
  day: CourtDay;
  clashes: Clash[];
  /** List changes since the previous snapshot; empty until a snapshot reader exists. */
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

/** Load one day for a member. Throws on a failed read so the route's error boundary shows. */
export async function loadBoard(input: {
  workspaceId: string;
  userId: string;
  role: Role;
  date: string;
}): Promise<BoardData> {
  const { db } = await import('@causedeck/core/runtime');
  const { getCourtDay } = await import('@causedeck/core/court-day');
  const day = await getCourtDay(
    { db },
    { workspaceId: input.workspaceId, userId: input.userId },
    { date: input.date, scope: can(input.role, 'court_day.view_all') ? 'workspace' : 'mine' },
  );
  return { day, clashes: await clashesOf(day), diffs: [], failures: [] };
}
