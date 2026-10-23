// `capture.process` hand-off (#43): the document pipeline (#45) consumes this job. Until it lands
// the body only claims the capture (`queued -> processing`) and reports whether AI steps may run;
// `ai_blocked` is read from the row, never from the payload, so a sensitive matter hint cannot be
// bypassed by a hand-built job. Idempotent: a capture that already left `queued` is skipped.
import type { CaptureChannel, CaptureFailureReason } from '@causedeck/capture';
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import type { CaptureJobDeps } from './context.ts';
import { loadCapture, moveCapture, type CaptureRecord } from './state.ts';

export type CaptureProcessOutcome =
  | { outcome: 'missing' }
  | { outcome: 'skipped' }
  | { outcome: 'started'; aiSteps: boolean; channel: CaptureChannel };

export async function runCaptureProcess(
  deps: Pick<CaptureJobDeps, 'db' | 'now'>,
  payload: { workspaceId: string; captureId: string; pipelineVersion: string },
): Promise<CaptureProcessOutcome> {
  const { workspaceId, captureId } = payload;
  const now = deps.now?.() ?? new Date();
  return withWorkspace(deps.db, { workspaceId }, async (tx): Promise<CaptureProcessOutcome> => {
    const row = await loadCapture(tx, workspaceId, captureId);
    if (row === null) return { outcome: 'missing' };
    if (row.status !== 'queued') return { outcome: 'skipped' };
    await moveCapture(tx, row, 'processing', now);
    return { outcome: 'started', aiSteps: !row.aiBlocked, channel: row.channel };
  });
}

/** Whether a capture may reach an AI step: false for a sensitive-matter capture, for good (CA-10). */
export async function aiStepsAllowed(
  db: CaptureJobDeps['db'],
  workspaceId: string,
  captureId: string,
): Promise<boolean> {
  const { capture } = schema;
  const [row] = await db
    .select({ aiBlocked: capture.aiBlocked })
    .from(capture)
    .where(and(eq(capture.id, captureId), eq(capture.workspaceId, workspaceId)));
  return row !== undefined && !row.aiBlocked;
}

/**
 * End a claimed capture (`processing -> ready | needs_you | failed`) from a channel handler such as
 * the ICS import (#53), merging `meta` (counts, no content) into `source_meta`. The caller holds the
 * workspace scope; a capture that is no longer `processing` is left alone (`null`).
 */
export async function finishCapture(
  db: Queryable,
  row: CaptureRecord,
  to: 'ready' | 'needs_you' | 'failed',
  meta: Record<string, unknown>,
  now: Date,
  reason?: CaptureFailureReason,
): Promise<CaptureRecord | null> {
  if (row.status !== 'processing') return null;
  const moved = await moveCapture(db, row, to, now, { processedAt: now }, reason);
  const { capture } = schema;
  const [updated] = await db
    .update(capture)
    .set({ sourceMeta: { ...moved.sourceMeta, ...meta } })
    .where(and(eq(capture.id, moved.id), eq(capture.workspaceId, moved.workspaceId)))
    .returning();
  return updated ?? moved;
}

/**
 * Close a capture whose review is done (`needs_you | ready -> applied`), as the ICS review screen
 * does once every event has been confirmed, skipped or noted (#53). Anything else is left alone.
 */
export async function closeReviewedCapture(
  db: Queryable,
  workspaceId: string,
  captureId: string,
  now: Date,
): Promise<boolean> {
  const row = await loadCapture(db, workspaceId, captureId);
  if (row === null || (row.status !== 'needs_you' && row.status !== 'ready')) return false;
  await moveCapture(db, row, 'applied', now);
  return true;
}
