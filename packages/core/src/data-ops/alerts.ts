// The alert ledger (#515, D-049): one open `data_ops_alert` row per `<type>:<sourceId>` key.
// A breach opens it (and notifies once), a repeat breach only refreshes `last_seen_at`, and the
// first clean verdict resolves it (and notifies once). The partial unique index on open dedup keys
// makes the open race-safe: the loser inserts nothing and sends nothing. A notice that reached no
// channel leaves `notified_at` null, so the next evaluation retries it.
import { schema, type Queryable } from '@causedeck/db';
import { and, eq, isNull, lte, gt, sql } from 'drizzle-orm';

import { dedupKey, type Detection } from './detectors.ts';
import { runbookUrl } from './runbooks.ts';
import type { AlertMessage, AlertNotifier } from './routing.ts';

const { dataOpsAlert, dataOpsOncall, user } = schema;

export interface ReconcileDeps {
  db: Queryable;
  notifier: AlertNotifier;
  now: Date;
}

export interface ReconcileReport {
  opened: number;
  refreshed: number;
  resolved: number;
}

/** The staff member covering `now` in the rotation, with their address; null when none does. */
export async function currentOncall(
  db: Queryable,
  now: Date,
): Promise<{ userId: string; email: string } | null> {
  const [row] = await db
    .select({ userId: dataOpsOncall.userId, email: user.email })
    .from(dataOpsOncall)
    .innerJoin(user, eq(user.id, dataOpsOncall.userId))
    .where(and(lte(dataOpsOncall.startsAt, now), gt(dataOpsOncall.endsAt, now)))
    .orderBy(sql`${dataOpsOncall.startsAt} desc`)
    .limit(1);
  return row ?? null;
}

async function oncallEmail(db: Queryable, userId: string | null): Promise<string | null> {
  if (userId === null) return null;
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  return row?.email ?? null;
}

function message(
  row: typeof dataOpsAlert.$inferSelect,
  email: string | null,
): AlertMessage {
  return {
    id: row.id,
    type: row.type,
    sourceId: row.sourceId,
    detail: row.detail,
    runbookUrl: row.runbookUrl,
    oncallEmail: email,
  };
}

/** Send the open notice and record that it went out. Failure leaves `notified_at` null to retry. */
async function notifyOpened(
  deps: ReconcileDeps,
  row: typeof dataOpsAlert.$inferSelect,
): Promise<void> {
  const email = await oncallEmail(deps.db, row.oncallUserId);
  try {
    await deps.notifier.opened(message(row, email));
  } catch {
    return;
  }
  await deps.db
    .update(dataOpsAlert)
    .set({ notifiedAt: deps.now })
    .where(and(eq(dataOpsAlert.id, row.id), isNull(dataOpsAlert.notifiedAt)));
}

/** Open, refresh or resolve the alert of one detection. */
export async function reconcileDetection(
  deps: ReconcileDeps,
  detection: Detection,
  report: ReconcileReport = { opened: 0, refreshed: 0, resolved: 0 },
): Promise<ReconcileReport> {
  const key = dedupKey(detection.type, detection.sourceId);
  const [open] = await deps.db
    .select()
    .from(dataOpsAlert)
    .where(and(eq(dataOpsAlert.dedupKey, key), eq(dataOpsAlert.status, 'open')))
    .limit(1);

  if (detection.breached) {
    if (open === undefined) {
      const oncall = await currentOncall(deps.db, deps.now);
      const [inserted] = await deps.db
        .insert(dataOpsAlert)
        .values({
          type: detection.type,
          sourceId: detection.sourceId,
          dedupKey: key,
          detail: detection.detail,
          runbookUrl: runbookUrl(detection.type),
          oncallUserId: oncall?.userId ?? null,
          openedAt: deps.now,
          lastSeenAt: deps.now,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted !== undefined) {
        report.opened += 1;
        await notifyOpened(deps, inserted);
      }
      return report;
    }
    await deps.db
      .update(dataOpsAlert)
      .set({ lastSeenAt: deps.now, detail: detection.detail })
      .where(eq(dataOpsAlert.id, open.id));
    report.refreshed += 1;
    if (open.notifiedAt === null) await notifyOpened(deps, open);
    return report;
  }

  if (open === undefined) return report;
  const [resolved] = await deps.db
    .update(dataOpsAlert)
    .set({ status: 'resolved', resolvedAt: deps.now, lastSeenAt: deps.now })
    .where(and(eq(dataOpsAlert.id, open.id), eq(dataOpsAlert.status, 'open')))
    .returning();
  if (resolved === undefined) return report;
  report.resolved += 1;
  try {
    await deps.notifier.resolved(message(resolved, await oncallEmail(deps.db, resolved.oncallUserId)));
    await deps.db
      .update(dataOpsAlert)
      .set({ resolveNotifiedAt: deps.now })
      .where(eq(dataOpsAlert.id, resolved.id));
  } catch {
    // The alert is resolved either way; a lost resolve notice is not retried.
  }
  return report;
}

/** Reconcile every detection of one evaluation. */
export async function reconcileAlerts(
  deps: ReconcileDeps,
  detections: readonly Detection[],
): Promise<ReconcileReport> {
  const report: ReconcileReport = { opened: 0, refreshed: 0, resolved: 0 };
  for (const detection of detections) await reconcileDetection(deps, detection, report);
  return report;
}
