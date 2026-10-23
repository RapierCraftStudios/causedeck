// Undo a bootstrap import (#57 part 3, #549): within 7 days of the apply, every matter activity of
// the batch's cascade group is reversed newest first: orders, hearings, obligations and listings
// are deleted, created proceedings
// are deleted children first, documents go back to where they were and a matter the import created
// is archived (a matter is never deleted by an undo). The batch ends `undone`.
import { schema, withWorkspace } from '@causedeck/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { UndoExpiredError, UndoRefusedError } from '../automation/index.ts';
import { archiveMatter, type GraphActor, type MatterGraphDeps } from '../matter-graph/index.ts';
import { conflict, notFound } from '../shared/errors.ts';

import { importGroupId, type ApplyDeps, type MatterUndoPayload } from './apply.ts';

export interface UndoImportResult {
  batchId: string;
  /** The matter activities reversed. */
  undone: number;
}

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = cause;
  }
  return undefined;
}

/** Reverse one batch; CONFLICT unless it is applied, `UndoExpiredError` after 7 days. */
export async function undoImportBatch(
  deps: ApplyDeps,
  actor: GraphActor,
  input: { batchId: string },
): Promise<UndoImportResult> {
  const { workspaceId, userId } = actor;
  const { batchId } = input;
  const events: Parameters<MatterGraphDeps['events']['emit']>[0][] = [];
  const result = await withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const { importBatch, activity, listing, hearing, order, obligation, proceeding, document } =
      schema;
    const now = (deps.now ?? (() => new Date()))();
    const gdeps: MatterGraphDeps = { ...deps, db: tx, events: { emit: (e) => events.push(e) } };
    const [batch] = await tx
      .select({ status: importBatch.status })
      .from(importBatch)
      .where(and(eq(importBatch.workspaceId, workspaceId), eq(importBatch.id, batchId)))
      .for('update');
    if (batch === undefined) throw notFound('Import batch not found');
    if (batch.status !== 'applied') throw conflict('Only an applied batch can be undone');
    const groupId = importGroupId(batchId);
    const rows = await tx
      .select()
      .from(activity)
      .where(
        and(
          eq(activity.workspaceId, workspaceId),
          eq(activity.cascadeGroupId, groupId),
          isNull(activity.undoneAt),
        ),
      )
      .orderBy(desc(activity.createdAt))
      .for('update');
    const root = rows.find((r) => r.id === groupId);
    if (root === undefined) throw notFound('The import activity was not found');
    if (now.getTime() > root.undoExpiresAt.getTime()) throw new UndoExpiredError();
    if (rows.some((r) => r.confirmedAt !== null)) {
      throw new UndoRefusedError(
        'You confirmed or edited part of this import, so it cannot be undone',
      );
    }
    const children = rows.filter((r) => r.id !== groupId);
    for (const row of children) {
      const p = row.undoPayload as unknown as MatterUndoPayload;
      try {
        await tx.transaction(async (sp) => {
          const where = (table: { workspaceId: AnyPgColumn; id: AnyPgColumn }, ids: string[]) =>
            and(eq(table.workspaceId, workspaceId), inArray(table.id, ids));
          if (p.orderIds.length > 0) await sp.delete(order).where(where(order, p.orderIds));
          if (p.hearingIds.length > 0) await sp.delete(hearing).where(where(hearing, p.hearingIds));
          if (p.obligationIds.length > 0) {
            await sp.delete(obligation).where(where(obligation, p.obligationIds));
          }
          if (p.listingIds.length > 0) await sp.delete(listing).where(where(listing, p.listingIds));
          for (const id of [...p.proceedingIds].reverse()) {
            await sp
              .delete(proceeding)
              .where(and(eq(proceeding.workspaceId, workspaceId), eq(proceeding.id, id)));
          }
          for (const d of p.documents) {
            await sp
              .update(document)
              .set({
                matterId: null,
                ...(d.unreadBySystem
                  ? { textStatus: 'pending' as const, textSkippedReason: null }
                  : {}),
                updatedAt: now,
              })
              .where(and(eq(document.workspaceId, workspaceId), eq(document.id, d.id)));
          }
        });
      } catch (error) {
        if (pgCode(error) === '23503') {
          throw conflict('Something was added to an imported record since; remove it first');
        }
        throw error;
      }
      if (p.matterCreated) await archiveMatter(gdeps, actor, { matterId: p.matterId });
    }
    await tx
      .update(activity)
      .set({ undoneAt: now, undoneBy: userId })
      .where(
        and(
          eq(activity.workspaceId, workspaceId),
          eq(activity.cascadeGroupId, groupId),
          isNull(activity.undoneAt),
        ),
      );
    await tx
      .update(importBatch)
      .set({ status: 'undone', updatedAt: now })
      .where(and(eq(importBatch.workspaceId, workspaceId), eq(importBatch.id, batchId)));
    deps.log?.('import.undone', { activities: children.length });
    return { batchId, undone: children.length };
  });
  for (const event of events) deps.events.emit(event);
  return result;
}
