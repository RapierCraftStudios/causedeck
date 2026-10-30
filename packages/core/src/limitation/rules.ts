// Rule table loading (#940). A counsel table is validated, then stored as the workspace's own
// unreviewed draft rules (`reviewed = false`): a draft never feeds a computation. Only a reviewed
// rule does (a platform rule reaches a workspace only once reviewed, by the `reviewed_only` policy).
import { schema } from '@causedeck/db';
import { RuleTable } from '@causedeck/validators/limitation';
import { and, asc, desc, eq } from 'drizzle-orm';

import { record } from '../audit/index.ts';

import { NoReviewedRuleError } from './errors.ts';
import {
  parseInput,
  withLimitation,
  type LimitationActor,
  type LimitationDeps,
  type LimitationScope,
} from './scope.ts';

const { limitationRule } = schema;

export type LimitationRuleRow = typeof limitationRule.$inferSelect;

export interface RuleView {
  id: string;
  code: string;
  title: string;
  statute: string;
  periodValue: number;
  periodUnit: string;
  startEvent: string;
  condonable: boolean;
  citation: string | null;
  tableVersion: string;
  reviewed: boolean;
  /** An unreviewed rule is a draft: it is listed but never used. */
  draft: boolean;
}

const view = (r: LimitationRuleRow): RuleView => ({
  id: r.id,
  code: r.code,
  title: r.title,
  statute: r.statute,
  periodValue: r.periodValue,
  periodUnit: r.periodUnit,
  startEvent: r.startEvent,
  condonable: r.condonable,
  citation: r.citation,
  tableVersion: r.tableVersion,
  reviewed: r.reviewed,
  draft: !r.reviewed,
});

/** The newest reviewed rule with `code`, or `NoReviewedRuleError`. */
export async function findReviewedRule(
  scope: LimitationScope,
  code: string,
): Promise<LimitationRuleRow> {
  const rows = await scope.tx
    .select()
    .from(limitationRule)
    .where(and(eq(limitationRule.code, code), eq(limitationRule.reviewed, true)))
    .orderBy(desc(limitationRule.createdAt), desc(limitationRule.tableVersion))
    .limit(1);
  const [row] = rows;
  if (row === undefined) {
    const any = await scope.tx
      .select({ id: limitationRule.id })
      .from(limitationRule)
      .where(eq(limitationRule.reviewed, true))
      .limit(1);
    throw new NoReviewedRuleError(any.length === 0 ? undefined : code);
  }
  return row;
}

/**
 * Import a counsel rule table as unreviewed drafts of this workspace. Owners and advocates only.
 * A code already imported at the same table version is left as it is.
 */
export async function loadRuleTable(
  deps: LimitationDeps,
  actor: LimitationActor,
  table: unknown,
): Promise<{ version: string; imported: number; skipped: number; draft: true }> {
  const data = parseInput(RuleTable, table);
  return withLimitation(deps, actor, 'write', async (scope) => {
    const rows = await scope.tx
      .insert(limitationRule)
      .values(
        data.rules.map((r) => ({
          workspaceId: actor.workspaceId,
          code: r.code,
          title: r.title,
          statute: r.statute,
          periodValue: r.periodValue,
          periodUnit: r.periodUnit,
          startEvent: r.startEvent,
          condonable: r.condonable,
          citation: r.citation ?? null,
          reviewed: false,
          reviewedAt: null,
          tableVersion: data.version,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: limitationRule.id });
    await record(
      {
        db: scope.tx,
        workspaceId: actor.workspaceId,
        actor: { userId: actor.userId, kind: 'user' },
      },
      {
        action: 'limitation.rules_imported',
        target: { kind: 'limitation_rule', id: rows[0]?.id ?? actor.workspaceId },
        metadata: { version: data.version, imported: rows.length, total: data.rules.length },
      },
    );
    return {
      version: data.version,
      imported: rows.length,
      skipped: data.rules.length - rows.length,
      draft: true,
    };
  });
}

/** The rules the member may see: reviewed ones and this workspace's drafts. Junior and up. */
export async function listRules(deps: LimitationDeps, actor: LimitationActor): Promise<RuleView[]> {
  return withLimitation(deps, actor, 'read', async (scope) => {
    if (!scope.canSeeRules) return [];
    const rows = await scope.tx
      .select()
      .from(limitationRule)
      .orderBy(asc(limitationRule.code), desc(limitationRule.tableVersion));
    return rows.map(view);
  });
}
