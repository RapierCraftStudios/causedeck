// Creating and completing a capture (#43; docs/product/09 §3, §5; spike §6). Capture is the trust
// boundary: nothing is read before it is sniffed, size-checked, scanned (when enabled) and
// de-duplicated, and nothing here opens, renders or executes a document: bytes are only hashed,
// sniffed by magic number and streamed to the scanner.
//
// `createCapture` checks the channel gate, the allow-list and the size cap, applies the
// sensitive-matter gate, asks `@causedeck/storage` for a presigned PUT (10 minutes) and records the
// capture `received`. `completeUpload` finalizes the object (storage re-reads and sniffs it,
// recomputes sha256), verifies size and hash, de-duplicates by sha256 within the workspace, then
// moves the capture to `scanning` (a scanner is configured) or `queued`. `createManualCapture`
// stores a typed note without a scan.
import { createHash, randomUUID } from 'node:crypto';

import {
  assertWithinCap,
  CAPTURE_PIPELINE_VERSION,
  CaptureTooLargeError,
  decideScan,
  initialTtl,
  resolveAllowedType,
  sizeCapBytes,
  transition,
  UnsupportedTypeError,
  type CaptureFailureReason,
  type CaptureInput,
  type CaptureStatus,
} from '@causedeck/capture';
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import {
  createUploadIntent,
  finalizeUpload,
  isUploadError,
  objectKey,
  type ObjectKey,
  type FinalizedUpload,
  type StorageCtx,
  type UploadIntent,
} from '@causedeck/storage';
import { and, asc, eq, notInArray, sql } from 'drizzle-orm';

import { invalid, notFound } from '../shared/errors.ts';

import { auditCapture } from './audit.ts';
import { assertChannelEnabled } from './channels.ts';
import type { CaptureCtx } from './context.ts';
import { SensitiveMatterExcludedError } from './errors.ts';
import { moveCapture, requireCapture, type CaptureRecord } from './state.ts';

const { blob, capture, matter } = schema;

export interface CreatedCapture {
  captureId: string;
  uploadUrl: string;
  headers: { 'content-type': string; 'content-length': string };
  expiresAt: Date;
}

export interface CompletedCapture {
  status: CaptureStatus;
  /** The earlier capture with the same bytes, for a duplicate. */
  duplicateOf?: string;
}

const scope = (ctx: CaptureCtx) => ({ workspaceId: ctx.workspaceId, userId: ctx.userId });

function storageContext(ctx: CaptureCtx, db: Queryable): StorageCtx {
  return {
    db,
    store: ctx.store,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    authorize: (action) => ctx.authorize(action),
    ...(ctx.now === undefined ? {} : { now: ctx.now }),
  };
}

/**
 * The sensitive-matter gate (CA-10). A hint at a `sensitive` matter sets `ai_blocked`; bulk import
 * refuses such a hint. A hint at a matter the caller cannot see is not found.
 */
async function matterGate(
  db: Queryable,
  ctx: Pick<CaptureCtx, 'workspaceId'>,
  channel: CaptureInput['channel'],
  matterHintId: string | undefined,
): Promise<boolean> {
  if (matterHintId === undefined) return false;
  const [row] = await db
    .select({ sensitive: matter.sensitive })
    .from(matter)
    .where(and(eq(matter.id, matterHintId), eq(matter.workspaceId, ctx.workspaceId)));
  if (row === undefined) throw notFound('Matter not found');
  if (row.sensitive && channel === 'bulk_import') throw new SensitiveMatterExcludedError();
  return row.sensitive;
}

/** Validate a capture and return a presigned PUT for its raw bytes. */
export async function createCapture(ctx: CaptureCtx, input: CaptureInput): Promise<CreatedCapture> {
  await ctx.authorize('document.write');
  const type = resolveAllowedType(input.filename, input.mime);
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw invalid('Empty or invalid file size');
  }
  assertWithinCap(type, input.sizeBytes, ctx.config.sizeCapsBytes);
  const now = ctx.now?.() ?? new Date();

  return withWorkspace(ctx.db, scope(ctx), async (tx) => {
    await assertChannelEnabled(tx, ctx.workspaceId, input.channel);
    const aiBlocked = await matterGate(tx, ctx, input.channel, input.matterHintId);

    let intent: UploadIntent;
    try {
      intent = await createUploadIntent(storageContext(ctx, tx), {
        kind: type.kind,
        filename: input.filename,
        size: input.sizeBytes,
        mime: type.mime,
        uploadTtlSeconds: ctx.config.presignTtlSeconds,
      });
    } catch (error) {
      if (isUploadError(error) && error.code === 'TOO_LARGE') {
        throw new CaptureTooLargeError(type.name, sizeCapBytes(type, ctx.config.sizeCapsBytes));
      }
      if (isUploadError(error) && error.code === 'VALIDATION') throw invalid(error.message);
      throw error;
    }

    const [row] = await tx
      .insert(capture)
      .values({
        workspaceId: ctx.workspaceId,
        channel: input.channel,
        status: 'received',
        rawStorageKey: intent.key,
        mime: type.mime,
        sizeBytes: input.sizeBytes,
        originalFilename: input.filename,
        sourceMeta: { ...input.sourceMeta, declaredSha256: input.sha256, history: [] },
        matterHintId: input.matterHintId ?? null,
        aiBlocked,
        scanStatus: 'pending',
        ttlAt: initialTtl({ mime: type.mime, createdAt: now }),
        createdBy: ctx.userId,
        createdAt: now,
      })
      .returning({ id: capture.id });
    if (row === undefined) throw new Error('capture insert returned no row');

    await auditCapture(
      ctx,
      tx,
      'capture.created',
      { kind: 'capture', id: row.id },
      {
        channel: input.channel,
        mime: type.mime,
        sizeBytes: input.sizeBytes,
        aiBlocked,
      },
    );
    return {
      captureId: row.id,
      uploadUrl: intent.upload.url,
      headers: intent.upload.headers,
      expiresAt: intent.upload.expiresAt,
    };
  });
}

type CompleteOutcome = { ok: true; result: CompletedCapture } | { ok: false; error: Error };

/** Remove the raw object and its blob row; the capture keeps its history and failure reason. */
async function dropRaw(ctx: CaptureCtx, tx: Queryable, key: string): Promise<void> {
  await ctx.store.delete(key as ObjectKey);
  await tx.delete(blob).where(and(eq(blob.key, key), eq(blob.workspaceId, ctx.workspaceId)));
}

async function fail(
  ctx: CaptureCtx,
  tx: Queryable,
  row: CaptureRecord,
  reason: CaptureFailureReason,
  error: Error,
  now: Date,
): Promise<CompleteOutcome> {
  const key = row.rawStorageKey;
  if (key !== null) await dropRaw(ctx, tx, key);
  await moveCapture(tx, row, 'failed', now, { rawStorageKey: null }, reason);
  await auditCapture(
    ctx,
    tx,
    'capture.completed',
    { kind: 'capture', id: row.id },
    {
      status: 'failed',
      reason,
    },
  );
  return { ok: false, error };
}

/**
 * Verify an uploaded capture and queue it. Idempotent once the capture left `received`. A rejected
 * upload (too large, not what was declared, wrong hash) is deleted and the capture marked `failed`
 * with a user-safe reason before the error is thrown.
 */
export async function completeUpload(
  ctx: CaptureCtx,
  captureId: string,
  claimedSha256: string,
): Promise<CompletedCapture> {
  await ctx.authorize('document.write');
  const now = ctx.now?.() ?? new Date();

  const outcome = await withWorkspace(ctx.db, scope(ctx), async (tx): Promise<CompleteOutcome> => {
    const row = await requireCapture(tx, ctx.workspaceId, captureId);
    // Only the member who started the capture completes it; anyone else reads as not found.
    if (row.createdBy !== ctx.userId) throw notFound('Capture not found');
    if (row.status !== 'received') {
      return {
        ok: true,
        result: {
          status: row.status,
          ...(row.dedupeOfCaptureId === null ? {} : { duplicateOf: row.dedupeOfCaptureId }),
        },
      };
    }
    const key = row.rawStorageKey;
    if (key === null) throw notFound('Capture not found');
    const declared = row.sourceMeta['declaredSha256'];
    if (typeof declared === 'string' && declared !== claimedSha256) {
      return fail(ctx, tx, row, 'hash_mismatch', invalid('The file hash does not match'), now);
    }

    const type = resolveAllowedType(row.originalFilename ?? '', row.mime);
    const head = await ctx.store.head(key as ObjectKey);
    if (head === null) throw invalid('upload not received');
    if (head.size > row.sizeBytes || head.size > sizeCapBytes(type, ctx.config.sizeCapsBytes)) {
      return fail(
        ctx,
        tx,
        row,
        'too_large',
        new CaptureTooLargeError(type.name, sizeCapBytes(type, ctx.config.sizeCapsBytes)),
        now,
      );
    }

    const [blobRow] = await tx
      .select({ id: blob.id })
      .from(blob)
      .where(and(eq(blob.key, key), eq(blob.workspaceId, ctx.workspaceId)));
    if (blobRow === undefined) throw notFound('Capture not found');

    let finalized: FinalizedUpload;
    try {
      finalized = await finalizeUpload(storageContext(ctx, tx), blobRow.id);
    } catch (error) {
      if (!isUploadError(error)) throw error;
      if (error.message === 'upload not received') throw invalid(error.message);
      // Storage deleted the object and its blob row; record why the capture ended.
      const tooLarge = error.code === 'TOO_LARGE';
      await moveCapture(
        tx,
        row,
        'failed',
        now,
        { rawStorageKey: null },
        tooLarge ? 'too_large' : head.size < row.sizeBytes ? 'hash_mismatch' : 'unsupported_type',
      );
      await auditCapture(
        ctx,
        tx,
        'capture.completed',
        { kind: 'capture', id: row.id },
        {
          status: 'failed',
          reason: tooLarge ? 'too_large' : 'unsupported_type',
        },
      );
      return {
        ok: false,
        error: tooLarge
          ? new CaptureTooLargeError(type.name, sizeCapBytes(type, ctx.config.sizeCapsBytes))
          : new UnsupportedTypeError('content_mismatch'),
      };
    }
    if (finalized.sha256 !== claimedSha256) {
      return fail(ctx, tx, row, 'hash_mismatch', invalid('The file hash does not match'), now);
    }

    // De-duplicate by sha256 within the workspace; the advisory lock serialises two completes of
    // the same bytes so exactly one capture stays processable.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.workspaceId}:${finalized.sha256}`}, 0))`,
    );
    const [original] = await tx
      .select({ id: capture.id })
      .from(capture)
      .where(
        and(
          eq(capture.workspaceId, ctx.workspaceId),
          eq(capture.sha256, finalized.sha256),
          sql`${capture.id} <> ${row.id}`,
          notInArray(capture.status, ['discarded', 'failed', 'quarantined', 'duplicate']),
        ),
      )
      .orderBy(asc(capture.createdAt), asc(capture.id))
      .limit(1);
    if (original !== undefined) {
      await dropRaw(ctx, tx, key);
      await moveCapture(tx, row, 'duplicate', now, {
        sha256: finalized.sha256,
        rawStorageKey: null,
        dedupeOfCaptureId: original.id,
        scanStatus: 'skipped',
        ttlAt: null,
      });
      await auditCapture(
        ctx,
        tx,
        'capture.completed',
        { kind: 'capture', id: row.id },
        {
          status: 'duplicate',
          duplicateOf: original.id,
        },
      );
      return { ok: true, result: { status: 'duplicate', duplicateOf: original.id } };
    }

    // The sensitive flag only ever turns on: re-read the hinted matter, never clear it (the
    // bulk-import exclusion was applied when the capture was created).
    const aiBlocked =
      row.aiBlocked || (await matterGate(tx, ctx, 'upload', row.matterHintId ?? undefined));
    const base = {
      sha256: finalized.sha256,
      mime: finalized.mime,
      sizeBytes: finalized.size,
      aiBlocked,
    };

    if (ctx.config.scan.clamav !== null) {
      await moveCapture(tx, row, 'scanning', now, base);
      await ctx.jobs.scan({
        workspaceId: ctx.workspaceId,
        captureId: row.id,
        sha256: finalized.sha256,
      });
      await auditCapture(
        ctx,
        tx,
        'capture.completed',
        { kind: 'capture', id: row.id },
        {
          status: 'scanning',
        },
      );
      return { ok: true, result: { status: 'scanning' } };
    }

    const decision = decideScan('skipped', ctx.config.scan.required);
    if (!decision.ok) {
      // Only `scan_required` reaches here: no scanner is configured and the deployment demands one.
      return fail(
        ctx,
        tx,
        row,
        'scan_required',
        invalid('Scanning is required but unavailable'),
        now,
      );
    }
    await tx
      .update(blob)
      .set({ scanStatus: 'skipped' })
      .where(and(eq(blob.id, blobRow.id), eq(blob.workspaceId, ctx.workspaceId)));
    await moveCapture(tx, row, 'queued', now, { ...base, scanStatus: 'skipped' });
    await ctx.jobs.process({
      workspaceId: ctx.workspaceId,
      captureId: row.id,
      pipelineVersion: CAPTURE_PIPELINE_VERSION,
    });
    await auditCapture(
      ctx,
      tx,
      'capture.completed',
      { kind: 'capture', id: row.id },
      {
        status: 'queued',
      },
    );
    return { ok: true, result: { status: 'queued' } };
  });
  if (!outcome.ok) throw outcome.error;
  return outcome.result;
}

export interface ManualCaptureInput {
  /** The typed note. Stored as a plain-text object; never interpreted here. */
  text: string;
  matterHintId?: string | undefined;
}

/** Capture a typed note: stored raw, scanning bypassed, queued for processing (L0 path). */
export async function createManualCapture(
  ctx: CaptureCtx,
  input: ManualCaptureInput,
): Promise<CompletedCapture & { captureId: string }> {
  await ctx.authorize('document.write');
  const bytes = Buffer.from(input.text, 'utf8');
  if (bytes.byteLength === 0) throw invalid('The note is empty');
  const type = resolveAllowedType('note.txt', 'text/plain');
  assertWithinCap(type, bytes.byteLength, ctx.config.sizeCapsBytes);
  const now = ctx.now?.() ?? new Date();
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  return withWorkspace(ctx.db, scope(ctx), async (tx) => {
    await assertChannelEnabled(tx, ctx.workspaceId, 'manual');
    const aiBlocked = await matterGate(tx, ctx, 'manual', input.matterHintId);
    const blobId = randomUUID();
    const key = objectKey({ workspaceId: ctx.workspaceId, kind: 'document', id: blobId }, now);
    await ctx.store.put({ key, body: bytes, contentType: type.mime });
    try {
      await tx.insert(blob).values({
        id: blobId,
        workspaceId: ctx.workspaceId,
        key,
        kind: 'document',
        filename: 'note.txt',
        size: bytes.byteLength,
        sha256,
        mime: type.mime,
        scanStatus: 'skipped',
        createdBy: ctx.userId,
        createdAt: now,
        finalizedAt: now,
      });
      const next = transition({ status: 'received', sourceMeta: {} }, 'queued', now);
      const [row] = await tx
        .insert(capture)
        .values({
          workspaceId: ctx.workspaceId,
          channel: 'manual',
          status: next.status,
          rawStorageKey: key,
          sha256,
          mime: type.mime,
          sizeBytes: bytes.byteLength,
          originalFilename: 'note.txt',
          sourceMeta: next.sourceMeta,
          matterHintId: input.matterHintId ?? null,
          aiBlocked,
          scanStatus: 'skipped',
          createdBy: ctx.userId,
          createdAt: now,
        })
        .returning({ id: capture.id });
      if (row === undefined) throw new Error('capture insert returned no row');
      await ctx.jobs.process({
        workspaceId: ctx.workspaceId,
        captureId: row.id,
        pipelineVersion: CAPTURE_PIPELINE_VERSION,
      });
      await auditCapture(
        ctx,
        tx,
        'capture.created',
        { kind: 'capture', id: row.id },
        {
          channel: 'manual',
          mime: type.mime,
          sizeBytes: bytes.byteLength,
          aiBlocked,
        },
      );
      return { captureId: row.id, status: 'queued' as const };
    } catch (error) {
      await ctx.store.delete(key).catch(() => undefined);
      throw error;
    }
  });
}
