// Raw-input retention (#43; docs/product/09 §8). `sweepExpiredCaptures` deletes the raw objects
// whose `ttl_at` has passed (a pin keeps them, except for a discarded capture), removes their blob
// rows and nulls `raw_storage_key`; derived data stays. Idempotent: swept rows no longer match.
// `setExtractionTtl` starts the 30-day clock for forwarded raw text once it was extracted (#54).
import { canTransition, forwardedTextTtl, type CaptureFailureReason } from '@causedeck/capture';
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import type { ObjectKey, ObjectStore } from '@causedeck/storage';
import { and, eq, isNotNull, lte, or } from 'drizzle-orm';

import { loadCapture, moveCapture } from './state.ts';

const { blob, capture } = schema;

/** Raw objects deleted per sweep of one workspace; the next run takes the rest. */
export const RETENTION_BATCH = 500;

export async function sweepExpiredCaptures(
  deps: { db: Queryable; store: ObjectStore; now?: () => Date },
  workspaceId: string,
): Promise<{ deleted: number }> {
  const now = deps.now?.() ?? new Date();
  return withWorkspace(deps.db, { workspaceId }, async (tx) => {
    const due = await tx
      .select({ id: capture.id, key: capture.rawStorageKey })
      .from(capture)
      .where(
        and(
          eq(capture.workspaceId, workspaceId),
          isNotNull(capture.rawStorageKey),
          lte(capture.ttlAt, now),
          or(eq(capture.pinned, false), eq(capture.status, 'discarded')),
        ),
      )
      .limit(RETENTION_BATCH);
    for (const { id, key } of due) {
      if (key === null) continue;
      await deps.store.delete(key as ObjectKey);
      await tx.delete(blob).where(and(eq(blob.key, key), eq(blob.workspaceId, workspaceId)));
      await tx
        .update(capture)
        .set({ rawStorageKey: null, ttlAt: null })
        .where(and(eq(capture.id, id), eq(capture.workspaceId, workspaceId)));
    }
    return { deleted: due.length };
  });
}

/**
 * Raw text expires 30 days after extraction unless pinned: set `ttl_at` for an email or WhatsApp
 * export capture (#526) whose text was just extracted. Returns the new `ttl_at`, or null when nothing applies.
 */
export async function setExtractionTtl(
  db: Queryable,
  workspaceId: string,
  captureId: string,
  extractedAt: Date,
): Promise<Date | null> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const row = await loadCapture(tx, workspaceId, captureId);
    if (
      row === null ||
      (row.channel !== 'email' && row.channel !== 'whatsapp_export') ||
      row.pinned ||
      row.rawStorageKey === null
    ) {
      return null;
    }
    const ttlAt = forwardedTextTtl(extractedAt);
    await tx
      .update(capture)
      .set({ ttlAt })
      .where(and(eq(capture.id, captureId), eq(capture.workspaceId, workspaceId)));
    return ttlAt;
  });
}

/**
 * Mark a capture `failed` with a user-safe reason, as the last act of a job whose retries ran out.
 * Runs in its own transaction (the job's own rolled back). A capture that cannot move to `failed`
 * (already finished or discarded) is left alone.
 */
export async function markCaptureFailed(
  db: Queryable,
  workspaceId: string,
  captureId: string,
  reason: CaptureFailureReason,
  now: Date = new Date(),
): Promise<boolean> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const row = await loadCapture(tx, workspaceId, captureId);
    if (row === null || !canTransition(row.status, 'failed')) return false;
    await moveCapture(tx, row, 'failed', now, {}, reason);
    return true;
  });
}
