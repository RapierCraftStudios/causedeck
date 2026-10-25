// Brief refresh (#60): `refreshBrief` reconciles one listing's stored state with the docket (a later
// material change clears the prepared mark and emits `brief.stale`); the brief itself is derived on
// read, so there is nothing else to rebuild. It is idempotent: the row is created once and a second
// run finds no mark, so it emits no second event. `refreshBriefTargets` is the sweep: tomorrow's
// listings and those with a confirmed next date within 7 days (India time), listed through the
// owner-defined `app_brief_refresh_targets()` because the job has no workspace. Triggers (a changed
// court-day list, a new extraction, a changed obligation) enqueue a refresh per affected listing.
import { isUuid, schema, withWorkspace, type Queryable } from '@causedeck/db';
import { and, eq, sql } from 'drizzle-orm';

import {
  type BriefDeps,
  type BriefEvent,
  type BriefScope,
  type BriefStaleReason,
  loadListing,
} from './assemble.ts';
import { clearIfStale } from './state.ts';

export interface RefreshTarget {
  workspaceId: string;
  listingId: string;
}

export interface RefreshResult {
  workspaceId: string;
  listingId: string;
  /** Why the prepared mark was cleared by this run, or null. */
  stale: BriefStaleReason | null;
}

/** Refresh one listing in its own workspace scope (a system run: no user). */
export async function refreshBrief(
  deps: Pick<BriefDeps, 'db' | 'events' | 'now'>,
  target: RefreshTarget,
): Promise<RefreshResult> {
  const { workspaceId, listingId } = target;
  const events: BriefEvent[] = [];
  const stale = await withWorkspace(deps.db, { workspaceId }, async (tx) => {
    const scope: BriefScope = {
      tx,
      actor: { userId: workspaceId, workspaceId, role: 'owner' },
      deps: { db: deps.db },
      now: (deps.now ?? (() => new Date()))(),
      settings: async () => {
        throw new Error('the refresh makes no policy decision');
      },
      emit: (event) => events.push(event),
      system: true,
    };
    await loadListing(scope, listingId);
    await tx
      .insert(schema.briefState)
      .values({ workspaceId, listingId })
      .onConflictDoNothing({ target: [schema.briefState.workspaceId, schema.briefState.listingId] });
    return clearIfStale(scope, listingId);
  });
  for (const event of events) deps.events?.emit(event);
  return { workspaceId, listingId, stale };
}

export interface SweepReport {
  targets: number;
  refreshed: number;
  stale: number;
  failed: number;
}

export interface SweepDeps extends Pick<BriefDeps, 'events' | 'now'> {
  /** The root database handle: the target function runs outside any workspace. */
  db: Queryable;
  log?: { warn: (obj: Record<string, unknown>, msg: string) => void };
}

/** The (workspace, listing) pairs to refresh, through the owner-defined function. */
export async function listRefreshTargets(db: Queryable): Promise<RefreshTarget[]> {
  const rows = await db.execute<{ workspace_id: string; listing_id: string }>(
    sql`select workspace_id::text, listing_id::text from app_brief_refresh_targets()`,
  );
  return rows.map((r) => ({ workspaceId: r.workspace_id, listingId: r.listing_id }));
}

/** The sweep: refresh every target; one failing listing is logged and does not stop the others. */
export async function refreshBriefTargets(deps: SweepDeps): Promise<SweepReport> {
  const targets = await listRefreshTargets(deps.db);
  const report: SweepReport = { targets: targets.length, refreshed: 0, stale: 0, failed: 0 };
  for (const target of targets) {
    try {
      const done = await refreshBrief({ db: deps.db as BriefDeps['db'], ...pick(deps) }, target);
      report.refreshed += 1;
      if (done.stale !== null) report.stale += 1;
    } catch (error) {
      report.failed += 1;
      deps.log?.warn(
        { ...target, error: error instanceof Error ? error.name : 'error' },
        'brief refresh failed',
      );
    }
  }
  return report;
}

function pick(deps: SweepDeps): Pick<BriefDeps, 'events' | 'now'> {
  return {
    ...(deps.events === undefined ? {} : { events: deps.events }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  };
}

/** The listings a changed court-day list touches (same forum and date), to enqueue a refresh each. */
export async function listingsOfChangedList(
  db: BriefDeps['db'],
  event: { workspaceId: string; forumId: string; listDate: string },
): Promise<RefreshTarget[]> {
  if (!isUuid(event.workspaceId)) return [];
  return withWorkspace(db, { workspaceId: event.workspaceId }, async (tx) => {
    const rows = await tx
      .select({ id: schema.listing.id })
      .from(schema.listing)
      .innerJoin(
        schema.proceeding,
        and(
          eq(schema.proceeding.workspaceId, schema.listing.workspaceId),
          eq(schema.proceeding.id, schema.listing.proceedingId),
        ),
      )
      .where(
        and(
          eq(schema.listing.workspaceId, event.workspaceId),
          eq(schema.listing.listDate, event.listDate),
          eq(schema.proceeding.forumId, event.forumId),
        ),
      );
    return rows.map((r) => ({ workspaceId: event.workspaceId, listingId: r.id }));
  });
}

export type EnqueueRefresh = (target: RefreshTarget) => Promise<unknown>;

/** Consume `court_day.list_changed`: enqueue `brief.refresh` for each listing of the changed list. */
export async function onCourtDayListChanged(
  db: BriefDeps['db'],
  event: { type: 'court_day.list_changed'; workspaceId: string; forumId: string; listDate: string },
  enqueue: EnqueueRefresh,
): Promise<number> {
  const targets = await listingsOfChangedList(db, event);
  for (const target of targets) await enqueue(target);
  return targets.length;
}
