// Free alerts enrolment (#506): after discovery and the confirm grid, a free advocate's cases are
// watched with no further setup. `enrollFreeAlerts` takes the actor's own non-sensitive, active
// matters' proceedings that have a CNR (or a full case number) at a forum with a status source and
// are not yet watched, and adds a case-status watch for each, up to the free tier's `maxWatches`
// (counting the watches the advocate already has). Listing and item alerts then follow from the
// confirmed cause-list and display-board data the matters already carry. Dark behind
// `growth.free-alerts`; a paid workspace is not enrolled (it sets up watches itself). Only ids and
// counts are returned or logged.
import { schema, withWorkspace } from '@causedeck/db';
import { and, asc, eq, isNull, or } from 'drizzle-orm';

import { addCaseWatch, STATUS_SOURCES } from '../case-watch/index.ts';
import type { GraphActor } from '../matter-graph/index.ts';

import { flagOf, nowOf, storeOf, type FreeAlertsDeps } from './budget.ts';

const { caseWatch, forum, matter, proceeding } = schema;

/**
 * Forum code prefix to the status source that reads it. The longest matching prefix wins, so a
 * High Court beats its state's district courts.
 */
export const FORUM_STATUS_SOURCES: readonly (readonly [prefix: string, sourceId: string])[] = [
  ['in.tn.madras-hc.', 'in.tn.madras-hc.chennai:case_status'],
  ['in.ka.karnataka-hc.', 'in.ka.karnataka-hc.bengaluru:case_status'],
  ['in.tn.chennai-district', 'in.tn.chennai-district:case_status'],
  ['in.tn.', 'in.tn.district:case_status'],
  ['in.ka.', 'in.ka.district:case_status'],
  ['in.mh.', 'in.mh.district:case_status'],
  ['in.dl.', 'in.dl.district:case_status'],
  ['in.up.', 'in.up.district:case_status'],
];

/** The status source for a forum code, or null when none reads it. */
export function statusSourceForForum(
  forumCode: string,
  sources: Readonly<Record<string, unknown>> = STATUS_SOURCES,
): string | null {
  let best: readonly [string, string] | null = null;
  for (const entry of FORUM_STATUS_SOURCES) {
    if (!forumCode.startsWith(entry[0]) || !(entry[1] in sources)) continue;
    if (best === null || entry[0].length > best[0].length) best = entry;
  }
  return best === null ? null : best[1];
}

export type EnrollSkipReason = 'flag_off' | 'not_free';

export interface EnrollReport {
  /** Watches added now. */
  enrolled: number;
  /** Cases that could be watched but would pass the free tier's watch allowance. */
  overLimit: number;
  skipped?: EnrollSkipReason;
}

/** Watch the actor's discovered cases, as far as the free tier allows. Idempotent. */
export async function enrollFreeAlerts(
  deps: FreeAlertsDeps,
  actor: GraphActor,
): Promise<EnrollReport> {
  if (!(await flagOf(deps)(actor.workspaceId))) {
    return { enrolled: 0, overLimit: 0, skipped: 'flag_off' };
  }
  const limits = await storeOf(deps).limits(actor.workspaceId, nowOf(deps));
  if (limits === null) return { enrolled: 0, overLimit: 0, skipped: 'not_free' };

  const { held, candidates } = await withWorkspace(deps.db, actor, async (tx) => {
    const mine = await tx
      .select({ proceedingId: caseWatch.proceedingId })
      .from(caseWatch)
      .where(
        and(
          eq(caseWatch.workspaceId, actor.workspaceId),
          eq(caseWatch.advocateUserId, actor.userId),
        ),
      );
    const rows = await tx
      .select({
        proceedingId: proceeding.id,
        cnr: proceeding.cnr,
        caseType: proceeding.caseTypeCode,
        number: proceeding.number,
        year: proceeding.year,
        forumCode: forum.code,
      })
      .from(proceeding)
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
      )
      .innerJoin(forum, eq(forum.id, proceeding.forumId))
      .where(
        and(
          eq(proceeding.workspaceId, actor.workspaceId),
          eq(matter.status, 'active'),
          eq(matter.sensitive, false),
          or(isNull(forum.workspaceId), eq(forum.workspaceId, actor.workspaceId)),
        ),
      )
      .orderBy(asc(proceeding.createdAt), asc(proceeding.id));
    return { held: new Set(mine.map((w) => w.proceedingId)), candidates: rows };
  });

  let room = Math.max(limits.maxWatches - held.size, 0);
  const report: EnrollReport = { enrolled: 0, overLimit: 0 };
  for (const row of candidates) {
    if (held.has(row.proceedingId)) continue;
    const sourceId = statusSourceForForum(row.forumCode);
    const caseNumber =
      row.number !== null && row.year !== null
        ? `${row.caseType} ${row.number}/${String(row.year)}`
        : null;
    if (sourceId === null || (row.cnr === null && caseNumber === null)) continue;
    if (room === 0) {
      report.overLimit += 1;
      continue;
    }
    try {
      await addCaseWatch(deps, actor, {
        proceedingId: row.proceedingId,
        sourceId,
        ...(row.cnr === null ? { caseNumber } : { cnr: row.cnr }),
      });
      held.add(row.proceedingId);
      room -= 1;
      report.enrolled += 1;
    } catch {
      // A proceeding the advocate cannot read or a malformed CNR is skipped; the rest still enrol.
    }
  }
  return report;
}
