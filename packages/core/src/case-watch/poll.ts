// The watch poll (#592, part 4 of #483, D-048): the body of the system `status.poll` job. It lists
// the watches that are due across workspaces (the owner-defined `app_case_watch_due`, the only
// cross-workspace read) and runs each as the watch's own advocate through `runCaseStatusLookup`, so
// a lookup is always delegated for that advocate's own matter and nothing is bulk or unscoped. On
// top of the fetch layer's per-source and per-advocate limits a run is capped per advocate, per
// source and in total; the rest wait for the next tick. An uncleared or killed source (the kill
// switch) is skipped for the whole run. Only ids and counts are logged.
import type { Database, Transaction } from '@causedeck/db';
import { sql } from 'drizzle-orm';

import type { GraphActor } from '../matter-graph/index.ts';
import { SourceNotCleared } from '../sources/index.ts';

import { notifyStatusChanges, type StatusAlertDeps } from './alerts.ts';
import {
  runCaseStatusLookup,
  touchWatchPolled,
  type CaseStatusLookupDeps,
  type StatusFetcher,
} from './lookup.ts';

type Db = Database | Transaction;

/** Watches fetched from one source for one advocate's own matters per run. */
export const MAX_PER_ADVOCATE_PER_RUN = 5;
/** Watches fetched from one status source per run. */
export const MAX_PER_SOURCE_PER_RUN = 20;
/** Watches considered per run. */
export const MAX_WATCHES_PER_RUN = 100;

export interface DueWatch {
  watchId: string;
  workspaceId: string;
  advocateUserId: string;
  sourceId: string;
}

export interface PollCaseWatchesDeps
  extends Omit<CaseStatusLookupDeps, 'db'>, Pick<StatusAlertDeps, 'enqueueDelivery'> {
  db: Db;
  /** The due watches, oldest first; defaults to `app_case_watch_due`. */
  listDue?: (limit: number) => Promise<DueWatch[]>;
  caps?: { perAdvocate?: number; perSource?: number; total?: number };
  log?: (event: string, fields: Record<string, unknown>) => void;
  /**
   * Called once per changed snapshot (never the watch's first, never a failure of the call itself:
   * errors are swallowed) with the ids and kinds of change; the job wires webhooks here (#626).
   */
  onChange?: (change: StatusChangeEvent) => Promise<unknown>;
  /**
   * Asked before each lookup (#506): false defers the watch to its next cadence without a fetch (a
   * free workspace at its fetch cost cap). Absent means every watch is admitted.
   */
  admit?: (watch: DueWatch) => Promise<boolean>;
  /** The fetcher one advocate's lookup uses (#506: counts the cost of a free workspace's fetches). */
  fetcherFor?: (actor: GraphActor) => StatusFetcher;
  /** A line appended to the order alert's body (#506: the free tier's upgrade prompt), or null. */
  alertNote?: (actor: GraphActor) => Promise<string | null>;
}

export interface StatusChangeEvent {
  workspaceId: string;
  watchId: string;
  sourceId: string;
  matterId: string;
  snapshotId: string;
  /** `next_date`, `order` and `stage`, as in the alerts. */
  kinds: string[];
}

export interface PollCaseWatchesReport {
  due: number;
  /** Lookups that reached the source and were read. */
  polled: number;
  changed: number;
  unchanged: number;
  /** Not looked up this run (a cap or a rate limit); they stay due. */
  deferred: number;
  /** Not looked up because the source is uncleared or killed. */
  skipped: number;
  /** Not looked up because the workspace is at its fetch cost cap (#506); they wait for the next cadence. */
  capped: number;
  failed: number;
  alerts: number;
}

async function defaultListDue(db: Db, limit: number): Promise<DueWatch[]> {
  const rows = await db.execute<{
    watch_id: string;
    workspace_id: string;
    advocate_user_id: string;
    source_id: string;
  }>(
    sql`select watch_id, workspace_id, advocate_user_id, source_id from app_case_watch_due(${limit})`,
  );
  return rows.map((r) => ({
    watchId: r.watch_id,
    workspaceId: r.workspace_id,
    advocateUserId: r.advocate_user_id,
    sourceId: r.source_id,
  }));
}

/** The `FetchDenied` of `@causedeck/fetch`, read structurally (core does not import it for types). */
function deniedReason(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, reason } = error as { code?: unknown; reason?: unknown };
  return code === 'FETCH_DENIED' && typeof reason === 'string' ? reason : null;
}

/** Poll every due watch once, each as its own advocate. One watch failing never stops the others. */
export async function pollCaseWatches(deps: PollCaseWatchesDeps): Promise<PollCaseWatchesReport> {
  const now = deps.now ?? (() => new Date());
  const perAdvocate = deps.caps?.perAdvocate ?? MAX_PER_ADVOCATE_PER_RUN;
  const perSource = deps.caps?.perSource ?? MAX_PER_SOURCE_PER_RUN;
  const total = deps.caps?.total ?? MAX_WATCHES_PER_RUN;
  const due = await (deps.listDue ?? ((limit) => defaultListDue(deps.db, limit)))(total);
  const report: PollCaseWatchesReport = {
    due: due.length,
    polled: 0,
    changed: 0,
    unchanged: 0,
    deferred: 0,
    skipped: 0,
    capped: 0,
    failed: 0,
    alerts: 0,
  };
  const bySource = new Map<string, number>();
  const byAdvocate = new Map<string, number>();
  const killedSources = new Set<string>();
  const limitedSources = new Set<string>();
  const limitedAdvocates = new Set<string>();

  for (const watch of due) {
    const advocateKey = `${watch.workspaceId}:${watch.advocateUserId}`;
    if (killedSources.has(watch.sourceId)) {
      report.skipped += 1;
      continue;
    }
    if (
      limitedSources.has(watch.sourceId) ||
      limitedAdvocates.has(advocateKey) ||
      (bySource.get(watch.sourceId) ?? 0) >= perSource ||
      (byAdvocate.get(advocateKey) ?? 0) >= perAdvocate
    ) {
      report.deferred += 1;
      continue;
    }
    // The advocate's own watch only: the actor is the watch's advocate in its workspace.
    const actor = { userId: watch.advocateUserId, workspaceId: watch.workspaceId };
    if (deps.admit !== undefined) {
      const admitted = await deps.admit(watch).catch(() => false);
      if (!admitted) {
        // At the cap: wait for the next cadence so it does not hold a slot in every run.
        report.capped += 1;
        await touchWatchPolled(deps.db, actor, watch.watchId, now()).catch(() => undefined);
        continue;
      }
    }
    bySource.set(watch.sourceId, (bySource.get(watch.sourceId) ?? 0) + 1);
    byAdvocate.set(advocateKey, (byAdvocate.get(advocateKey) ?? 0) + 1);
    try {
      const lookupDeps = deps.fetcherFor ? { ...deps, fetcher: deps.fetcherFor(actor) } : deps;
      const done = await runCaseStatusLookup(lookupDeps, actor, { watchId: watch.watchId });
      report.polled += 1;
      if (done.outcome === 'changed') {
        report.changed += 1;
        if (done.snapshotId !== null && done.changes !== null && done.matterId !== null) {
          const note = await deps.alertNote?.(actor).catch(() => null);
          report.alerts += await notifyStatusChanges(deps, actor, {
            ...(note ? { orderNote: note } : {}),
            snapshotId: done.snapshotId,
            matterId: done.matterId,
            changes: done.changes,
            firstSnapshot: done.firstSnapshot,
          });
          if (!done.firstSnapshot && deps.onChange !== undefined) {
            const kinds = [
              ...(done.changes.nextHearingDate === null ? [] : ['next_date']),
              ...(done.changes.newOrders.length === 0 ? [] : ['order']),
              ...(done.changes.stage === null ? [] : ['stage']),
            ];
            try {
              await deps.onChange({
                workspaceId: watch.workspaceId,
                watchId: watch.watchId,
                sourceId: watch.sourceId,
                matterId: done.matterId,
                snapshotId: done.snapshotId,
                kinds,
              });
            } catch {
              // An event that cannot be emitted never fails the poll.
            }
          }
        }
      } else if (done.outcome === 'unchanged') {
        report.unchanged += 1;
      } else {
        // Nothing stored (case not found, page not recognised): still honour the cadence.
        await touchWatchPolled(deps.db, actor, watch.watchId, now());
      }
    } catch (error) {
      const denied = deniedReason(error);
      if (error instanceof SourceNotCleared) {
        killedSources.add(watch.sourceId);
        report.skipped += 1;
        deps.log?.('status poll source not cleared', { sourceId: watch.sourceId });
      } else if (denied === 'source_rate_limited' || denied === 'host_rate_limited') {
        limitedSources.add(watch.sourceId);
        report.deferred += 1;
      } else if (denied === 'advocate_rate_limited') {
        limitedAdvocates.add(advocateKey);
        report.deferred += 1;
      } else {
        report.failed += 1;
        deps.log?.('status poll lookup failed', {
          watchId: watch.watchId,
          error: error instanceof Error ? error.name : 'error',
        });
        // A failed lookup waits for its next cadence instead of retrying every tick.
        await touchWatchPolled(deps.db, actor, watch.watchId, now()).catch(() => undefined);
      }
    }
  }
  return report;
}
