// Free-plan entitlements of the bootstrap import (#57 part 3, #549): the fair-use caps of #30 decide
// how many files of a batch are read. Past the OCR cap a file is kept as an attachment without being
// read and no AI call is made for it. The batch's cost is what its captures' AI calls cost.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { assertWithinFairUse, FairUseError, type UsageContext } from '../usage/index.ts';

export interface ImportFile {
  id: string;
  pages: number;
}

export interface FileAllowance {
  /** Files that may be read, in the order given. */
  read: string[];
  /** Files past the cap: attached, never read, no AI called. */
  attachOnly: string[];
}

/**
 * Split `files` into those within the workspace's monthly OCR cap and those past it. Pages are
 * counted cumulatively on top of what the period already used (`assertWithinFairUse` reads it); a null cap reads everything.
 */
export async function splitByOcrAllowance(
  ctx: UsageContext,
  files: readonly ImportFile[],
): Promise<FileAllowance> {
  const result: FileAllowance = { read: [], attachOnly: [] };
  let planned = 0;
  let capped = false;
  for (const file of files) {
    const pages = Math.max(1, Math.trunc(file.pages));
    if (!capped) {
      try {
        await assertWithinFairUse(ctx, 'ocr.pages', planned + pages);
      } catch (error) {
        if (!(error instanceof FairUseError)) throw error;
        capped = true;
      }
    }
    if (capped) {
      result.attachOnly.push(file.id);
    } else {
      planned += pages;
      result.read.push(file.id);
    }
  }
  return result;
}

/** The paise the AI calls of `captureIds` cost: the cost per batch. */
export async function batchCostPaise(
  db: Database | Transaction,
  workspaceId: string,
  captureIds: readonly string[],
): Promise<number> {
  if (captureIds.length === 0) return 0;
  const { aiCall } = schema;
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const [row] = await tx
      .select({ total: sql<number>`coalesce(sum(${aiCall.costPaise}), 0)::int` })
      .from(aiCall)
      .where(and(eq(aiCall.workspaceId, workspaceId), inArray(aiCall.captureId, [...captureIds])));
    return row?.total ?? 0;
  });
}
