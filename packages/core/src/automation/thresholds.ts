// Threshold learning (#47; docs/product/09 §5): every undo of an auto-applied action raises the
// confidence needed to auto-apply that kind and pattern again by 0.02, up to 0.99. A later draft
// below the threshold is downgraded to a proposal by `decideLevel`.
import { schema, type Transaction } from '@causedeck/db';
import type { ProposalKind } from '@causedeck/validators/proposal-draft';
import { and, eq, sql } from 'drizzle-orm';

import { thresholdKey } from './decide.ts';
import { APPROVAL_MATRIX, DEFAULT_LEARNED_BASE } from './matrix.ts';

export const THRESHOLD_STEP = 0.02;
export const THRESHOLD_CAP = 0.99;

const { automationThreshold } = schema;

/** `value + 0.02`, capped at 0.99, to three decimals (the column's scale). */
export function raised(value: number): number {
  return Math.min(THRESHOLD_CAP, Math.round((value + THRESHOLD_STEP) * 1000) / 1000);
}

/** The workspace's learned thresholds, keyed for `decideLevel`. */
export async function loadThresholds(
  tx: Transaction,
  workspaceId: string,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      kind: automationThreshold.kind,
      patternKey: automationThreshold.patternKey,
      threshold: automationThreshold.threshold,
    })
    .from(automationThreshold)
    .where(eq(automationThreshold.workspaceId, workspaceId));
  return new Map(
    rows.map((row): [string, number] => [
      thresholdKey(row.kind as ProposalKind, row.patternKey),
      Number(row.threshold),
    ]),
  );
}

/**
 * Raise the threshold of `(kind, patternKey)` after an undo and return the new value. A kind with
 * no threshold yet starts from its matrix base, or 0.8, so the first undo makes it 0.82 or more.
 */
export async function raiseThreshold(
  tx: Transaction,
  workspaceId: string,
  kind: ProposalKind,
  patternKey: string,
): Promise<number> {
  const base = APPROVAL_MATRIX[kind].baseThreshold ?? DEFAULT_LEARNED_BASE;
  const [current] = await tx
    .select({ threshold: automationThreshold.threshold })
    .from(automationThreshold)
    .where(
      and(
        eq(automationThreshold.workspaceId, workspaceId),
        eq(automationThreshold.kind, kind),
        eq(automationThreshold.patternKey, patternKey),
      ),
    )
    .limit(1)
    .for('update');
  const next = raised(current === undefined ? base : Number(current.threshold));
  await tx
    .insert(automationThreshold)
    .values({ workspaceId, kind, patternKey, threshold: next.toFixed(3), undoCount: 1 })
    .onConflictDoUpdate({
      target: [
        automationThreshold.workspaceId,
        automationThreshold.kind,
        automationThreshold.patternKey,
      ],
      set: {
        threshold: next.toFixed(3),
        undoCount: sql`${automationThreshold.undoCount} + 1`,
        updatedAt: new Date(),
      },
    });
  return next;
}
