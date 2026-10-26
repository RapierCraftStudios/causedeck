// The server side of the offline pull (#65 part 2, #743): the court-day boards of a date range plus
// the brief of every listing on them, as one snapshot the client caches encrypted. Nothing here
// decides who may see what: `loadBoard` (`getCourtDay`) already leaves out the listings of a
// restricted matter, or one a junior is not on, and `assembleBrief` re-checks `listing.read`. A
// listing whose brief is refused is skipped, never cached. The `purge` lists tell the client which
// cached ids to drop: anything it holds that this snapshot no longer contains (outside the window,
// removed from the member's view) and members who left the workspace.
import type { BriefDeps } from '@causedeck/core/briefs';
import type { Brief, CourtDay } from '@causedeck/validators';

import { domainErrorCode } from '../../../../../lib/matters/graph-deps.ts';
import type { Role } from '../../../../../lib/workspace-context.ts';
import { loadBoard, type BoardData } from '../_court-day/load-court-day.ts';

/** The widest range of one pull: a week, as the offline cache holds (inclusive of both ends). */
export const MAX_PULL_DAYS = 7;

/** Ids the client already caches, so the answer can say which to purge. */
export interface KnownIds {
  matterIds: string[];
  listingIds: string[];
  memberIds: string[];
}

export interface PurgeList {
  matterIds: string[];
  listingIds: string[];
  memberIds: string[];
}

export interface CourtDaySnapshot {
  generatedAt: string;
  from: string;
  to: string;
  days: BoardData[];
  briefs: Brief[];
  purge: PurgeList;
}

export interface SnapshotScope {
  workspaceId: string;
  userId: string;
  role: Role;
}

/** The dates `from..to` inclusive (ISO days); empty when `to` is before `from`. */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const start = new Date(`${from}T00:00:00Z`).getTime();
  for (let at = start; ; at += 86_400_000) {
    const date = new Date(at).toISOString().slice(0, 10);
    if (date > to) break;
    dates.push(date);
  }
  return dates;
}

export function daysInRange(from: string, to: string): number {
  return datesBetween(from, to).length;
}

function listingIdsOf(day: CourtDay): string[] {
  return day.complexes.flatMap((c) =>
    c.halls.flatMap((h) => h.lists.flatMap((l) => l.items.map((i) => i.listingId))),
  );
}

function matterIdsOf(day: CourtDay): string[] {
  return day.complexes.flatMap((c) =>
    c.halls.flatMap((h) => h.lists.flatMap((l) => l.items.map((i) => i.matterId))),
  );
}

const missing = (known: readonly string[], present: ReadonlySet<string>): string[] =>
  [...new Set(known)].filter((id) => !present.has(id));

/**
 * Build the snapshot. `assemble` reads one brief (null when the member may not) and `memberIdsOf`
 * the workspace's active member ids; both are injected so the logic is testable without a database.
 */
export async function buildSnapshot(
  input: { from: string; to: string; known: KnownIds },
  deps: {
    loadDay: (date: string) => Promise<BoardData>;
    assemble: (listingId: string) => Promise<Brief | null>;
    memberIdsOf: () => Promise<string[]>;
    now: () => Date;
  },
): Promise<CourtDaySnapshot> {
  const days: BoardData[] = [];
  for (const date of datesBetween(input.from, input.to)) days.push(await deps.loadDay(date));
  const listingIds = [...new Set(days.flatMap((d) => listingIdsOf(d.day)))];
  const briefs: Brief[] = [];
  for (const id of listingIds) {
    const brief = await deps.assemble(id);
    if (brief !== null) briefs.push(brief);
  }
  const briefed = new Set(briefs.map((b) => b.listing_id));
  const matters = new Set(days.flatMap((d) => matterIdsOf(d.day)));
  const members = new Set(await deps.memberIdsOf());
  return {
    generatedAt: deps.now().toISOString(),
    from: input.from,
    to: input.to,
    days,
    briefs,
    purge: {
      // A listing without a brief is not cached, so a cached copy of it goes too.
      listingIds: missing(input.known.listingIds, briefed),
      matterIds: missing(input.known.matterIds, matters),
      memberIds: missing(input.known.memberIds, members),
    },
  };
}

/** Pull the snapshot for a member in their workspace transaction. */
export async function pullSnapshot(
  scope: SnapshotScope,
  tx: BriefDeps['db'],
  input: { from: string; to: string; known: KnownIds },
): Promise<CourtDaySnapshot> {
  const { assembleBrief } = await import('@causedeck/core/briefs');
  const { listMembersIn } = await import('@causedeck/core/runtime');
  const actor = { workspaceId: scope.workspaceId, userId: scope.userId };
  return buildSnapshot(input, {
    loadDay: (date) => loadBoard({ ...actor, role: scope.role, date }),
    assemble: async (listingId) => {
      try {
        return await assembleBrief({ db: tx }, actor, listingId);
      } catch (error) {
        const code = domainErrorCode(error);
        if (code === 'FORBIDDEN' || code === 'NOT_FOUND') return null;
        throw error;
      }
    },
    memberIdsOf: async () => (await listMembersIn(actor)).map((m) => m.memberId),
    now: () => new Date(),
  });
}
