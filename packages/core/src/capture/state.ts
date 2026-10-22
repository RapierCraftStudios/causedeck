// Row helpers shared by the capture services (#43): load a capture in the scoped workspace and move
// it through the status machine, recording the transition in `source_meta.history`.
import {
  transition,
  type CaptureFailureReason,
  type CaptureScanStatus,
  type CaptureStatus,
} from '@causedeck/capture';
import { schema, type Queryable } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import { notFound } from '../shared/errors.ts';

const { capture } = schema;

export type CaptureRecord = typeof capture.$inferSelect;

export interface CapturePatch {
  sha256?: string | null;
  mime?: string;
  sizeBytes?: number;
  rawStorageKey?: string | null;
  dedupeOfCaptureId?: string | null;
  aiBlocked?: boolean;
  scanStatus?: CaptureScanStatus;
  pinned?: boolean;
  ttlAt?: Date | null;
  processedAt?: Date | null;
}

/** The capture in the scoped workspace, locked for update; `null` when absent or RLS-hidden. */
export async function loadCapture(
  db: Queryable,
  workspaceId: string,
  captureId: string,
  lock = true,
): Promise<CaptureRecord | null> {
  const query = db
    .select()
    .from(capture)
    .where(and(eq(capture.id, captureId), eq(capture.workspaceId, workspaceId)));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

export async function requireCapture(
  db: Queryable,
  workspaceId: string,
  captureId: string,
): Promise<CaptureRecord> {
  const row = await loadCapture(db, workspaceId, captureId);
  if (row === null) throw notFound('Capture not found');
  return row;
}

/**
 * Move `row` to `to` (throws `IllegalTransitionError` for an illegal move), applying `patch` and
 * the failure reason in the same update. Guarded on the status the row was read in.
 */
export async function moveCapture(
  db: Queryable,
  row: CaptureRecord,
  to: CaptureStatus,
  at: Date,
  patch: CapturePatch = {},
  reason?: CaptureFailureReason,
): Promise<CaptureRecord> {
  const next = transition({ status: row.status, sourceMeta: row.sourceMeta }, to, at, reason);
  const sourceMeta =
    to === 'failed' && reason !== undefined
      ? { ...next.sourceMeta, failureReason: reason }
      : next.sourceMeta;
  const [updated] = await db
    .update(capture)
    .set({ ...patch, status: next.status, sourceMeta })
    .where(
      and(
        eq(capture.id, row.id),
        eq(capture.workspaceId, row.workspaceId),
        eq(capture.status, row.status),
      ),
    )
    .returning();
  if (updated === undefined) throw notFound('Capture not found');
  return updated;
}
