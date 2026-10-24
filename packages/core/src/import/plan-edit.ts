// Plan edits from the confirm grid (#57 part 5, #551): rename, merge, split and move-proceeding
// change how the stored plan's proceedings are grouped into matters, never what they say. The grid
// sends the grouping (`tempId`, title, proceeding keys); `regroupPlan` rebuilds the matters from the
// stored proceedings, so the derived next date, issues and sources can never be forged and no new
// row text can enter the plan (matched-only, #548). `saveEditedImportPlan` stores it while the batch
// is still `ready`; apply then reads the edited plan like any other.
import { createHash } from 'node:crypto';

import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import type { GraphActor } from '../matter-graph/index.ts';
import { conflict, invalid, notFound } from '../shared/errors.ts';

import { compareText } from './cluster.ts';
import type {
  ImportPlan,
  PlanHistoryEntry,
  PlanIssue,
  PlanMatter,
  PlanProceeding,
  PlanSource,
} from './plan-types.ts';

export interface PlanGroupEdit {
  /** An existing matter `tempId` keeps its identity; any other value is a new matter. */
  tempId: string;
  title: string;
  proceedingKeys: string[];
}

export interface PlanEditDeps {
  db: Database | Transaction;
}

const MAX_TITLE = 200;

function newTempId(keys: readonly string[]): string {
  return `m_${createHash('sha256')
    .update([...keys].sort(compareText).join('\n'))
    .digest('hex')
    .slice(0, 12)}`;
}

function mergeSources(sources: readonly PlanSource[]): PlanSource[] {
  const seen = new Map<string, PlanSource>();
  for (const source of sources) seen.set(source.proposalId, source);
  return [...seen.values()].sort((a, b) => compareText(a.proposalId, b.proposalId));
}

/**
 * The plan with its proceedings regrouped as `groups` say. Every proceeding of the stored plan must
 * be placed exactly once; the matters' next date, issues, confidence and sources are recomputed.
 */
export function regroupPlan(plan: ImportPlan, groups: readonly PlanGroupEdit[]): ImportPlan {
  const byKey = new Map<string, { proceeding: PlanProceeding; from: PlanMatter }>();
  for (const matter of plan.matters) {
    for (const proceeding of matter.proceedings)
      byKey.set(proceeding.key, { proceeding, from: matter });
  }
  const placed = new Set<string>();
  const used = new Set<string>();
  const storedIds = new Set(plan.matters.map((m) => m.tempId));
  const matters: PlanMatter[] = [];
  const matterOfKey = new Map<string, string>();
  for (const group of groups) {
    const title = group.title.trim();
    if (title === '' || title.length > MAX_TITLE) throw invalid('A matter needs a title');
    if (group.proceedingKeys.length === 0) throw invalid('A matter needs a proceeding');
    const entries = group.proceedingKeys.map((key) => {
      const entry = byKey.get(key);
      if (entry === undefined) throw invalid('Unknown proceeding in the edited plan');
      if (placed.has(key)) throw invalid('A proceeding can sit in one matter only');
      placed.add(key);
      return entry;
    });
    const tempId = storedIds.has(group.tempId) ? group.tempId : newTempId(group.proceedingKeys);
    if (used.has(tempId)) throw invalid('Two matters share one identity');
    used.add(tempId);
    const proceedings = entries.map((e) => e.proceeding);
    const origins = [...new Set(entries.map((e) => e.from))];
    const issues: PlanIssue[] = proceedings.flatMap((p) =>
      p.nextDateCandidates.length > 1
        ? [
            {
              code: 'conflicting_dates' as const,
              blocking: true,
              proceedingKey: p.key,
              dates: p.nextDateCandidates.map((d) => d.date),
            },
          ]
        : [],
    );
    if (origins.some((o) => o.issues.some((i) => i.code === 'low_confidence'))) {
      issues.push({ code: 'low_confidence', blocking: false });
    }
    const dates = proceedings.flatMap((p) => (p.nextDate === null ? [] : [p.nextDate]));
    const only = origins.length === 1 ? origins[0] : undefined;
    matters.push({
      tempId,
      title,
      proceedings,
      nextDate: dates.sort((a, b) => compareText(a.date, b.date))[0] ?? null,
      issues,
      confidence: Math.min(...origins.map((o) => o.confidence)),
      reason:
        only !== undefined && only.proceedings.length === proceedings.length
          ? only.reason
          : 'grouped by you',
      sources: mergeSources(proceedings.flatMap((p) => p.sources)),
    });
    for (const p of proceedings) matterOfKey.set(p.key, tempId);
  }
  if (placed.size !== byKey.size) throw invalid('Every proceeding must stay in the plan');

  const history: PlanHistoryEntry[] = plan.history.map((entry) => ({
    ...entry,
    matterTempId: matterOfKey.get(entry.proceedingKey) ?? entry.matterTempId,
  }));
  const firstOf = new Map(
    plan.matters.map((m) => [m.tempId, matterOfKey.get(m.proceedings[0]?.key ?? '')] as const),
  );
  const obligations = plan.obligations.map((o) => ({
    ...o,
    matterTempId: firstOf.get(o.matterTempId) ?? o.matterTempId,
  }));
  return { ...plan, matters, history, obligations };
}

/** The stored plan of `batchId`; another workspace's batch, or one without a plan, is NOT_FOUND. */
export async function getImportPlan(
  deps: PlanEditDeps,
  actor: GraphActor,
  batchId: string,
): Promise<ImportPlan> {
  const { importPlan } = schema;
  const { workspaceId } = actor;
  const [row] = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .select({ plan: importPlan.plan })
      .from(importPlan)
      .where(and(eq(importPlan.workspaceId, workspaceId), eq(importPlan.batchId, batchId))),
  );
  if (row === undefined) throw notFound('Import plan not found');
  return row.plan as unknown as ImportPlan;
}

/** Store the regrouped plan while the batch is `ready`; an applied batch's plan is final. */
export async function saveEditedImportPlan(
  deps: PlanEditDeps,
  actor: GraphActor,
  input: { batchId: string; groups: readonly PlanGroupEdit[] },
): Promise<ImportPlan> {
  const { importBatch, importPlan } = schema;
  const { workspaceId } = actor;
  const { batchId } = input;
  return withWorkspace(deps.db, actor, async (tx) => {
    const [batch] = await tx
      .select({ status: importBatch.status })
      .from(importBatch)
      .where(and(eq(importBatch.workspaceId, workspaceId), eq(importBatch.id, batchId)))
      .for('update');
    if (batch === undefined) throw notFound('Import batch not found');
    const [stored] = await tx
      .select({ plan: importPlan.plan })
      .from(importPlan)
      .where(and(eq(importPlan.workspaceId, workspaceId), eq(importPlan.batchId, batchId)));
    if (stored === undefined) throw notFound('Import plan not found');
    if (batch.status !== 'ready') throw conflict('Only a batch that is ready can be edited');
    const edited = regroupPlan(stored.plan as unknown as ImportPlan, input.groups);
    await tx
      .update(importPlan)
      .set({ plan: edited as unknown as Record<string, unknown> })
      .where(and(eq(importPlan.workspaceId, workspaceId), eq(importPlan.batchId, batchId)));
    return edited;
  });
}
