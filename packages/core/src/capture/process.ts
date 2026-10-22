// `capture.process` hand-off (#43): the document pipeline (#45) consumes this job. Until it lands
// the body only claims the capture (`queued -> processing`) and reports whether AI steps may run;
// `ai_blocked` is read from the row, never from the payload, so a sensitive matter hint cannot be
// bypassed by a hand-built job. Idempotent: a capture that already left `queued` is skipped.
import { schema, withWorkspace } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import type { CaptureJobDeps } from './context.ts';
import { loadCapture, moveCapture } from './state.ts';

export type CaptureProcessOutcome =
  { outcome: 'missing' } | { outcome: 'skipped' } | { outcome: 'started'; aiSteps: boolean };

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
    return { outcome: 'started', aiSteps: !row.aiBlocked };
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
