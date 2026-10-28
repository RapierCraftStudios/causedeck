// The DB-backed `CorrectionStore` (#558, port from #56): grid corrections saved to the `correction`
// table, linked to their document, on the caller's workspace-scoped transaction (RLS and the
// composite document FK keep another workspace's rows and documents out). Eval reuse needs BOTH the
// workspace opt-in (`workspace_settings.allow_eval_reuse`, owner-set, default false) and the
// per-item consent; `listForEvalExport` is the only read that serves an eval set and returns nothing
// unless both hold. The text is customer content: never sent to a model, never used for training.
import { schema, type Database, type Transaction } from '@causedeck/db';
import type { A0Correction, CorrectionStore } from '@causedeck/intelligence';
import { and, eq, inArray } from 'drizzle-orm';

import { requireCan, getAllowEvalReuse } from '../workspaces/index.ts';

type Queryable = Database | Transaction;

const { correction } = schema;

export interface CorrectionStoreContext {
  db: Queryable;
  workspaceId: string;
  /** The member saving the corrections. */
  actorUserId: string;
}

/** A stored correction with its id and consent state. */
export interface StoredCorrection extends A0Correction {
  id: string;
  evalConsent: boolean;
}

export function createCorrectionStore(ctx: CorrectionStoreContext): CorrectionStore {
  return {
    async save(corrections) {
      if (corrections.length === 0) return;
      await ctx.db.insert(correction).values(
        corrections.map((c) => ({
          workspaceId: ctx.workspaceId,
          documentId: c.documentId,
          forumCode: c.forumCode,
          rowKey: c.rowKey,
          columnName: c.column,
          before: c.before,
          after: c.after,
          page: c.page,
          quote: c.quote,
          createdBy: ctx.actorUserId,
        })),
      );
    },
  };
}

function toStored(row: typeof correction.$inferSelect): StoredCorrection {
  return {
    id: row.id,
    documentId: row.documentId,
    forumCode: row.forumCode,
    rowKey: row.rowKey,
    column: row.columnName,
    before: row.before,
    after: row.after,
    page: row.page,
    quote: row.quote,
    evalConsent: row.evalConsent,
  };
}

/** The corrections of one document, oldest first. */
export async function listDocumentCorrections(
  db: Queryable,
  workspaceId: string,
  documentId: string,
): Promise<StoredCorrection[]> {
  const rows = await db
    .select()
    .from(correction)
    .where(and(eq(correction.workspaceId, workspaceId), eq(correction.documentId, documentId)))
    .orderBy(correction.createdAt, correction.id);
  return rows.map(toStored);
}

/**
 * Record (or withdraw) the person's consent to share these corrections in an eval set. Granting
 * needs the workspace opt-in; it is refused otherwise. Needs `workspace.manage`.
 */
export async function setCorrectionEvalConsent(
  db: Queryable,
  request: { workspaceId: string; actorUserId: string; correctionIds: string[]; consent: boolean },
): Promise<{ updated: number }> {
  const { workspaceId, actorUserId, correctionIds, consent } = request;
  if (correctionIds.length === 0) return { updated: 0 };
  return db.transaction(async (tx) => {
    await requireCan(tx, workspaceId, actorUserId, 'workspace.manage');
    if (consent && !(await getAllowEvalReuse(tx, workspaceId))) {
      throw new Error('Eval reuse is not allowed for this workspace');
    }
    const rows = await tx
      .update(correction)
      .set({ evalConsent: consent })
      .where(and(eq(correction.workspaceId, workspaceId), inArray(correction.id, correctionIds)))
      .returning({ id: correction.id });
    return { updated: rows.length };
  });
}

/** Corrections that may enter an eval set: the workspace allows it and the item is consented. */
export async function listForEvalExport(
  db: Queryable,
  workspaceId: string,
): Promise<StoredCorrection[]> {
  if (!(await getAllowEvalReuse(db, workspaceId))) return [];
  const rows = await db
    .select()
    .from(correction)
    .where(and(eq(correction.workspaceId, workspaceId), eq(correction.evalConsent, true)))
    .orderBy(correction.createdAt, correction.id);
  return rows.map(toStored);
}
