// Discarding and pinning a capture (#43). A member discards their own capture; a member with
// `workspace.manage` any capture. Discarding makes the raw object due at once, so the daily
// `capture.retention` job deletes it within 24 hours; the derived data stays. A pin keeps the raw
// object past its TTL (a discarded capture is never kept: discarding clears the pin).
import { discardTtl, historyOf } from '@causedeck/capture';
import { schema, withWorkspace } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import { forbidden } from '../shared/errors.ts';

import { auditCapture } from './audit.ts';
import type { CaptureCtx } from './context.ts';
import { moveCapture, requireCapture, type CaptureRecord } from './state.ts';

const { capture } = schema;

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
