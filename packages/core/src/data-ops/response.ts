// Auto-response (#515, D-049). A block signature backs the source off (the window doubles with each
// consecutive block, capped) and marks it degraded; the fetcher refuses it until the window ends.
// A parse-yield drop quarantines the parser version: `source_health.quarantined_parser_version`
// is the review queue (`listReviewQueue`), where staff pick the quarantined parsers up. Both clear
// when their detector recovers. State lives in `source_health`, so every replica agrees.
import { schema, type Queryable } from '@causedeck/db';
import { eq, isNotNull, or } from 'drizzle-orm';

import { reconcileDetection, type ReconcileDeps } from './alerts.ts';
import { detectBlockSignature, type SourceMetrics } from './detectors.ts';

const { sourceHealth } = schema;

export const BACKOFF_BASE_MINUTES = 15;
export const BACKOFF_MAX_MINUTES = 360;

/** The backoff window after `step` consecutive blocks (0 for the first). */
export function backoffMinutes(step: number): number {
  return Math.min(BACKOFF_BASE_MINUTES * 2 ** step, BACKOFF_MAX_MINUTES);
}

async function healthOf(db: Queryable, sourceId: string) {
  const [row] = await db.select().from(sourceHealth).where(eq(sourceHealth.sourceId, sourceId));
  return row;
}

/** Back the source off and mark it degraded; a no-op while a backoff is already running. */
export async function applyBlockBackoff(
  db: Queryable,
  sourceId: string,
  now: Date,
  reason: string,
): Promise<{ started: boolean; backoffUntil: Date }> {
  const row = await healthOf(db, sourceId);
  if (row?.backoffUntil && row.backoffUntil.getTime() > now.getTime()) {
    return { started: false, backoffUntil: row.backoffUntil };
  }
  const step = row?.backoffStep ?? 0;
  const backoffUntil = new Date(now.getTime() + backoffMinutes(step) * 60_000);
  await db
    .insert(sourceHealth)
    .values({
      sourceId,
      state: 'degraded',
      backoffUntil,
      backoffStep: step + 1,
      reason,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sourceHealth.sourceId,
      set: { state: 'degraded', backoffUntil, backoffStep: step + 1, reason, updatedAt: now },
    });
  return { started: true, backoffUntil };
}

/** Lift a finished backoff once the source is clean; healthy again unless a parser is quarantined. */
export async function clearBlockBackoff(db: Queryable, sourceId: string, now: Date): Promise<void> {
  const row = await healthOf(db, sourceId);
  if (row === undefined || (row.backoffUntil === null && row.backoffStep === 0)) return;
  await db
    .update(sourceHealth)
    .set({
      backoffUntil: null,
      backoffStep: 0,
      state: row.quarantinedParserVersion === null ? 'ok' : 'degraded',
      reason: row.quarantinedParserVersion === null ? null : row.reason,
      updatedAt: now,
    })
    .where(eq(sourceHealth.sourceId, sourceId));
}

/** Quarantine a parser version into the review queue and mark the source degraded. */
export async function quarantineParser(
  db: Queryable,
  sourceId: string,
  parserVersion: string,
  now: Date,
  reason: string,
): Promise<boolean> {
  const row = await healthOf(db, sourceId);
  if (row?.quarantinedParserVersion === parserVersion) return false;
  await db
    .insert(sourceHealth)
    .values({
      sourceId,
      state: 'degraded',
      quarantinedParserVersion: parserVersion,
      quarantinedAt: now,
      reason,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sourceHealth.sourceId,
      set: {
        state: 'degraded',
        quarantinedParserVersion: parserVersion,
        quarantinedAt: now,
        reason,
        updatedAt: now,
      },
    });
  return true;
}

/** Take the parser out of the review queue once its yield recovered. */
export async function releaseQuarantine(db: Queryable, sourceId: string, now: Date): Promise<void> {
  const row = await healthOf(db, sourceId);
  if (row?.quarantinedParserVersion == null) return;
  const stillBackedOff = row.backoffUntil !== null && row.backoffUntil.getTime() > now.getTime();
  await db
    .update(sourceHealth)
    .set({
      quarantinedParserVersion: null,
      quarantinedAt: null,
      state: stillBackedOff ? 'degraded' : 'ok',
      reason: stillBackedOff ? row.reason : null,
      updatedAt: now,
    })
    .where(eq(sourceHealth.sourceId, sourceId));
}

export interface ReviewQueueItem {
  sourceId: string;
  parserVersion: string;
  quarantinedAt: Date;
}

/** Parser versions waiting for review, oldest first. */
export async function listReviewQueue(db: Queryable): Promise<ReviewQueueItem[]> {
  const rows = await db
    .select()
    .from(sourceHealth)
    .where(isNotNull(sourceHealth.quarantinedParserVersion));
  return rows
    .flatMap((r) =>
      r.quarantinedParserVersion === null || r.quarantinedAt === null
        ? []
        : [
            {
              sourceId: r.sourceId,
              parserVersion: r.quarantinedParserVersion,
              quarantinedAt: r.quarantinedAt,
            },
          ],
    )
    .sort((a, b) => a.quarantinedAt.getTime() - b.quarantinedAt.getTime());
}

/** The source ids currently degraded or backed off, for consoles (#514). */
export async function listDegraded(db: Queryable): Promise<string[]> {
  const rows = await db
    .select({ sourceId: sourceHealth.sourceId })
    .from(sourceHealth)
    .where(or(eq(sourceHealth.state, 'degraded')));
  return rows.map((r) => r.sourceId);
}

/**
 * The `FetchHealth` the fetcher takes (`@causedeck/fetch`): `backoffUntil` reads `source_health`,
 * and `reportBlock` backs the source off and opens the block alert, once, in the same call.
 */
export function createFetchHealth(deps: Omit<ReconcileDeps, 'now'> & { now?: () => Date }): {
  backoffUntil(sourceId: string): Promise<Date | null>;
  reportBlock(event: { sourceId: string; signature: string; at: Date }): Promise<void>;
} {
  const clock = deps.now ?? (() => new Date());
  return {
    async backoffUntil(sourceId) {
      return (await healthOf(deps.db, sourceId))?.backoffUntil ?? null;
    },
    async reportBlock({ sourceId, signature, at }) {
      await applyBlockBackoff(deps.db, sourceId, at, `block:${signature}`);
      const now = clock();
      await reconcileDetection(
        { db: deps.db, notifier: deps.notifier, now },
        {
          type: 'block_signature',
          sourceId,
          breached: true,
          detail: `block signature ${signature}; backing off`,
        },
      );
    },
  };
}

/** Apply the responses a verdict calls for. Returns nothing: effects are in `source_health`. */
export async function applyResponses(
  db: Queryable,
  metrics: SourceMetrics,
  detections: readonly {
    type: string;
    breached: boolean;
    parserVersion?: string;
    detail: string;
  }[],
  now: Date,
): Promise<void> {
  for (const d of detections) {
    if (d.type === 'block_signature') {
      if (d.breached) {
        await applyBlockBackoff(db, metrics.sourceId, now, 'block signature');
      } else {
        await clearBlockBackoff(db, metrics.sourceId, now);
      }
    }
    if (d.type === 'parse_yield') {
      if (d.breached && d.parserVersion !== undefined) {
        await quarantineParser(
          db,
          metrics.sourceId,
          d.parserVersion,
          now,
          'parse yield below floor',
        );
      } else if (!d.breached) {
        await releaseQuarantine(db, metrics.sourceId, now);
      }
    }
  }
}

export { detectBlockSignature };
