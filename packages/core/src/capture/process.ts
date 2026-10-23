// `capture.process` hand-off (#43): the document pipeline (#45) consumes this job.
// `runCaptureProcess` only claims the capture (`queued -> processing`) and reports whether AI steps
// may run; `runCapturePipeline` runs the document pipeline end to end and moves the capture on.
// `ai_blocked` is read from the row, never from the payload, so a sensitive matter hint cannot be
// bypassed by a hand-built job. Idempotent: a capture that already left `queued` is skipped.
import type { AiGateway } from '@causedeck/ai';
import type { CaptureChannel, CaptureFailureReason } from '@causedeck/capture';
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import {
  createDbPersister,
  createGatewayClassifier,
  createGatewayOcr,
  mupdfRenderer,
  processCapture,
  type FinishedOutcome,
  type IntelligenceEvents,
  type OcrLanguage,
  type PageRenderer,
} from '@causedeck/intelligence';
import {
  ObjectNotFoundError,
  type KeyProvider,
  type ObjectKey,
  type ObjectStore,
} from '@causedeck/storage';
import { and, eq } from 'drizzle-orm';

import type { CaptureJobDeps } from './context.ts';
import { runDiaryStep, type DiarySummary } from './diary.ts';
import { markCaptureFailed } from './retention.ts';
import { loadCapture, moveCapture, type CaptureRecord } from './state.ts';

const { capture: captureTable } = schema;

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

export interface CapturePipelineDeps {
  db: Queryable;
  store: ObjectStore;
  keys: KeyProvider;
  /** The AI gateway (budgets, India-only mode, audit); injected so this domain stays AI-free. */
  gateway: AiGateway;
  renderer?: PageRenderer;
  /** Where `document.processed`, `capture.classified` and `document.near_duplicate` go. */
  events?: IntelligenceEvents;
  now?: () => Date;
}

export type CapturePipelineOutcome =
  | { outcome: 'missing' }
  | { outcome: 'skipped' }
  | { outcome: 'failed' }
  /** Not a document (an ICS file is read by its own channel handler): the caller takes over. */
  | { outcome: 'not_document' }
  /** AI is paused or over budget: the capture stays `queued` and is marked "processing later". */
  | { outcome: 'deferred' }
  | { outcome: 'ready' | 'needs_you'; documentId: string | null; reason: string | null };

const LANGUAGE_HINTS: readonly string[] = ['en', 'ta', 'kn'];

function languageHintOf(row: CaptureRecord): OcrLanguage | null {
  for (const key of ['languageHint', 'forumLanguage']) {
    const value = row.sourceMeta[key];
    if (typeof value === 'string' && LANGUAGE_HINTS.includes(value)) return value as OcrLanguage;
  }
  return null;
}

async function readRaw(store: ObjectStore, key: ObjectKey): Promise<Uint8Array> {
  const stream = await store.getStream(key);
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream.body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Move a `queued` or `processing` capture to the pipeline's outcome: `ready`, or `needs_you` with
 * the reason (and the document, if one was stored) in `source_meta`. A capture that already
 * finished is left alone, so a replay changes nothing.
 */
async function finishPipelineCapture(
  tx: Queryable,
  workspaceId: string,
  captureId: string,
  outcome: FinishedOutcome,
  now: Date,
  diary: DiarySummary | null = null,
): Promise<void> {
  let row = await loadCapture(tx, workspaceId, captureId);
  if (row === null) return;
  if (row.status === 'queued') row = await moveCapture(tx, row, 'processing', now);
  if (row.status !== 'processing') return;
  const moved = await moveCapture(tx, row, outcome.status, now, { processedAt: now });
  const meta = { ...moved.sourceMeta };
  delete meta.processingLater;
  await tx
    .update(captureTable)
    .set({
      sourceMeta: {
        ...meta,
        ...(outcome.documentId === null ? {} : { documentId: outcome.documentId }),
        ...(outcome.reason === null ? {} : { needsYouReason: outcome.reason }),
        ...(outcome.lowConfidencePages.length === 0
          ? {}
          : { lowConfidencePages: outcome.lowConfidencePages }),
        ...(outcome.skippedReason === null ? {} : { textSkippedReason: outcome.skippedReason }),
        ...(outcome.route == null ? {} : { cameraRoute: outcome.route }),
        ...(diary === null ? {} : { diary }),
      },
    })
    .where(and(eq(captureTable.id, captureId), eq(captureTable.workspaceId, workspaceId)));
}

/**
 * Run the document pipeline (#45) for a `queued` capture and move it on: `ready`, `needs_you`
 * (unreadable, password protected, corrupt; the raw object is kept) or, when OCR needs AI that is
 * paused or over budget, left `queued` with `source_meta.processingLater`. The document and the
 * capture's new status commit together. Idempotent: a capture that left `queued` is skipped, and
 * a document already stored for this `(capture, pipelineVersion)` is not rebuilt.
 */
export async function runCapturePipeline(
  deps: CapturePipelineDeps,
  payload: { workspaceId: string; captureId: string; pipelineVersion: string },
): Promise<CapturePipelineOutcome> {
  const { workspaceId, captureId, pipelineVersion } = payload;
  const now = deps.now?.() ?? new Date();
  const row = await withWorkspace(deps.db, { workspaceId }, (tx) =>
    loadCapture(tx, workspaceId, captureId, false),
  );
  if (row === null) return { outcome: 'missing' };
  if (row.status !== 'queued') return { outcome: 'skipped' };
  if (row.channel === 'ics') return { outcome: 'not_document' };
  const key = row.rawStorageKey as ObjectKey | null;
  if (key === null || row.sha256 === null) {
    await markCaptureFailed(deps.db, workspaceId, captureId, 'upload_missing', now);
    return { outcome: 'failed' };
  }

  let bytes: Uint8Array;
  try {
    bytes = await readRaw(deps.store, key);
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) throw error;
    await markCaptureFailed(deps.db, workspaceId, captureId, 'upload_missing', now);
    return { outcome: 'failed' };
  }

  const scope = {
    workspaceId,
    captureId,
    ...(row.matterHintId === null ? {} : { matterId: row.matterHintId }),
    ...(row.createdBy === null ? {} : { userId: row.createdBy }),
  };
  const outcome = await processCapture(
    {
      ocr: createGatewayOcr({ gateway: deps.gateway, scope, pipelineVersion }),
      llm: createGatewayClassifier({ gateway: deps.gateway, scope, pipelineVersion }),
      renderer: deps.renderer ?? mupdfRenderer,
      persister: createDbPersister({
        db: deps.db,
        store: deps.store,
        keys: deps.keys,
        ...(deps.now ? { now: deps.now } : {}),
      }),
      ...(deps.events ? { events: deps.events } : {}),
      onPersisted: async (tx, finished) => {
        // A photographed diary page is structured in the same transaction (#52).
        const diary = await runDiaryStep(tx, row, finished, { now, pipelineVersion });
        await finishPipelineCapture(tx, workspaceId, captureId, diary.outcome, now, diary.summary);
      },
    },
    {
      workspaceId,
      captureId,
      matterId: row.matterHintId,
      userId: row.createdBy,
      bytes,
      mime: row.mime,
      sha256: row.sha256,
      rawStorageKey: key,
      aiBlocked: row.aiBlocked,
      languageHint: languageHintOf(row),
      pipelineVersion,
      channel: row.channel,
    },
  );

  if (outcome.status === 'deferred') {
    await withWorkspace(deps.db, { workspaceId }, async (tx) => {
      const current = await loadCapture(tx, workspaceId, captureId);
      if (current === null || current.status !== 'queued') return;
      await tx
        .update(captureTable)
        .set({ sourceMeta: { ...current.sourceMeta, processingLater: true } })
        .where(and(eq(captureTable.id, captureId), eq(captureTable.workspaceId, workspaceId)));
    });
    return { outcome: 'deferred' };
  }
  // The persisting transaction already moved the capture for a new document; this covers a
  // failure with no document and a replay (finishing is a no-op once the capture has moved).
  await withWorkspace(deps.db, { workspaceId }, (tx) =>
    finishPipelineCapture(tx, workspaceId, captureId, outcome, now),
  );
  return { outcome: outcome.status, documentId: outcome.documentId, reason: outcome.reason };
}
