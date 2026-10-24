// Discarding and pinning a capture (#43). A member discards their own capture; a member with
// `workspace.manage` any capture. Discarding makes the raw object due at once, so the daily
// `capture.retention` job deletes it within 24 hours; the derived data stays. A pin keeps the raw
// object past its TTL (a discarded capture is never kept: discarding clears the pin).
import { discardTtl, historyOf } from '@causedeck/capture';
import { schema, withWorkspace } from '@causedeck/db';
import type { ObjectKey } from '@causedeck/storage';
import { and, eq, sql } from 'drizzle-orm';

import { conflict, forbidden } from '../shared/errors.ts';

import { auditCapture } from './audit.ts';
import type { CaptureCtx } from './context.ts';
import { createManualCapture } from './create.ts';
import { moveCapture, requireCapture, type CaptureRecord } from './state.ts';

const { anchor, blob, capture, document } = schema;

const scope = (ctx: CaptureCtx) => ({ workspaceId: ctx.workspaceId, userId: ctx.userId });

async function ownOrManage(ctx: CaptureCtx, row: CaptureRecord): Promise<void> {
  if (row.createdBy === ctx.userId) {
    await ctx.authorize('document.write');
    return;
  }
  try {
    await ctx.authorize('workspace.manage');
  } catch {
    throw forbidden('You can only change your own captures');
  }
}

/** Discard a capture. Idempotent for an already discarded capture; other terminal states throw. */
export function discardCapture(ctx: CaptureCtx, captureId: string): Promise<CaptureRecord> {
  const now = ctx.now?.() ?? new Date();
  return withWorkspace(ctx.db, scope(ctx), async (tx) => {
    const row = await requireCapture(tx, ctx.workspaceId, captureId);
    await ownOrManage(ctx, row);
    if (row.status === 'discarded') return row;
    const updated = await moveCapture(tx, row, 'discarded', now, {
      ttlAt: discardTtl(now),
      pinned: false,
    });
    await auditCapture(
      ctx,
      tx,
      'capture.discarded',
      { kind: 'capture', id: row.id },
      {
        channel: row.channel,
        fromStatus: row.status,
        transitions: historyOf(updated.sourceMeta).length,
      },
    );
    return updated;
  });
}

/** Pin or unpin a capture's raw object. A discarded capture cannot be pinned. */
export function pinCapture(
  ctx: CaptureCtx,
  captureId: string,
  pinned: boolean,
): Promise<CaptureRecord> {
  return withWorkspace(ctx.db, scope(ctx), async (tx) => {
    const row = await requireCapture(tx, ctx.workspaceId, captureId);
    await ownOrManage(ctx, row);
    if (row.status === 'discarded') throw forbidden('A discarded capture cannot be pinned');
    const [updated] = await tx
      .update(capture)
      .set({ pinned })
      .where(and(eq(capture.id, row.id), eq(capture.workspaceId, row.workspaceId)))
      .returning();
    return updated ?? row;
  });
}

/**
 * Keep an unreadable capture as an unprocessed document (#48): `needs_you -> ready`, nothing read
 * or guessed from it. Any other status cannot be kept and throws a conflict.
 */
export function keepCaptureAsAttachment(
  ctx: CaptureCtx,
  captureId: string,
): Promise<CaptureRecord> {
  const now = ctx.now?.() ?? new Date();
  return withWorkspace(ctx.db, scope(ctx), async (tx) => {
    const row = await requireCapture(tx, ctx.workspaceId, captureId);
    await ownOrManage(ctx, row);
    if (row.status === 'ready') return row;
    if (row.status !== 'needs_you') throw conflict('This capture cannot be kept as an attachment');
    const updated = await moveCapture(tx, row, 'ready', now);
    await auditCapture(
      ctx,
      tx,
      'capture.completed',
      { kind: 'capture', id: row.id },
      { channel: row.channel, keptAsAttachment: true },
    );
    return updated;
  });
}

/**
 * Type the key line of an unreadable capture (#48): a manual (L0) capture linked to the original
 * through `source_meta.linkedCaptureId`, with the original's matter hint. The typed text is stored
 * as written; nothing is inferred from the unreadable file.
 */
export async function createKeyLineCapture(
  ctx: CaptureCtx,
  input: { captureId: string; text: string },
): Promise<{ captureId: string; linkedCaptureId: string }> {
  const original = await withWorkspace(ctx.db, scope(ctx), (tx) =>
    requireCapture(tx, ctx.workspaceId, input.captureId),
  );
  await ownOrManage(ctx, original);
  const created = await createManualCapture(ctx, {
    text: input.text,
    ...(original.matterHintId === null ? {} : { matterHintId: original.matterHintId }),
  });
  await withWorkspace(ctx.db, scope(ctx), (tx) =>
    tx
      .update(capture)
      .set({
        sourceMeta: sql`${capture.sourceMeta} || ${JSON.stringify({ linkedCaptureId: original.id })}::jsonb`,
      })
      .where(and(eq(capture.id, created.captureId), eq(capture.workspaceId, ctx.workspaceId))),
  );
  return { captureId: created.captureId, linkedCaptureId: original.id };
}

/** The id and key of the stored transcript a voice capture recorded in `source_meta.voice`. */
function storedTranscript(row: CaptureRecord): { documentId: string; key: string } | null {
  const voice = row.sourceMeta['voice'];
  if (typeof voice !== 'object' || voice === null) return null;
  const { transcriptDocumentId, transcriptKey } = voice as Record<string, unknown>;
  return typeof transcriptDocumentId === 'string' && typeof transcriptKey === 'string'
    ? { documentId: transcriptDocumentId, key: transcriptKey }
    : null;
}

/**
 * Delete a voice recording and its transcript at once (#542): the raw audio object and the
 * transcript object and their blob rows go; the transcript document and its anchors stay with
 * their quotes blanked (applied proposals point at the anchors), and every proposal and the
 * capture row stay. Idempotent. Own capture, or `workspace.manage`.
 */
export function deleteRecording(ctx: CaptureCtx, captureId: string): Promise<CaptureRecord> {
  return withWorkspace(ctx.db, scope(ctx), async (tx) => {
    const row = await requireCapture(tx, ctx.workspaceId, captureId);
    await ownOrManage(ctx, row);
    if (row.channel !== 'voice') throw conflict('Only a voice recording can be deleted this way');
    const transcript = storedTranscript(row);
    const keys = [row.rawStorageKey, transcript?.key ?? null].filter(
      (key): key is string => key !== null,
    );
    for (const key of keys) {
      await ctx.store.delete(key as ObjectKey);
      await tx.delete(blob).where(and(eq(blob.key, key), eq(blob.workspaceId, ctx.workspaceId)));
    }
    if (transcript !== null) {
      await tx
        .update(anchor)
        .set({ quote: '' })
        .where(
          and(
            eq(anchor.documentId, transcript.documentId),
            eq(anchor.workspaceId, ctx.workspaceId),
          ),
        );
      await tx
        .update(document)
        .set({ textStatus: 'skipped', textSkippedReason: 'recording_deleted' })
        .where(
          and(eq(document.id, transcript.documentId), eq(document.workspaceId, ctx.workspaceId)),
        );
    }
    if (keys.length === 0) return row;
    const [updated] = await tx
      .update(capture)
      .set({
        rawStorageKey: null,
        ttlAt: null,
        sourceMeta: sql`${capture.sourceMeta} || ${JSON.stringify({ recordingDeleted: true })}::jsonb`,
      })
      .where(and(eq(capture.id, row.id), eq(capture.workspaceId, row.workspaceId)))
      .returning();
    await auditCapture(
      ctx,
      tx,
      'capture.recording_deleted',
      { kind: 'capture', id: row.id },
      { channel: row.channel, transcriptDeleted: transcript !== null },
    );
    return updated ?? row;
  });
}
