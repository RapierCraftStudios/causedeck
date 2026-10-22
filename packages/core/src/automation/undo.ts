// Undo (#47; docs/product/09 §5): an auto-applied (L3) action can be reversed for 7 days with one
// tap. It cascades: undoing the action that put a document on the wrong matter also removes the
// tasks, list data and records derived from it in the same cascade group. Undo is refused once the
// window has closed (`UndoExpiredError`) or once the lawyer has confirmed or edited the result.
// Each undo raises the auto-apply threshold of that kind and pattern (thresholds.ts).
import { can } from '@causedeck/auth/policy';
import { schema } from '@causedeck/db';
import type { ProposalKind } from '@causedeck/validators/proposal-draft';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import type { GraphActor, MatterGraphDeps } from '../matter-graph/index.ts';
import { conflict, forbidden, invalid, notFound } from '../shared/errors.ts';

import { auditAutomation } from './audit.ts';
import { inAutomationScope, requireCan } from './context.ts';
import { UndoExpiredError, UndoRefusedError } from './errors.ts';
import { handlerFor } from './handlers/index.ts';
import { raiseThreshold } from './thresholds.ts';
import type { ActivityRow, HandlerScope } from './types.ts';

const { activity, document, matter, matterRestriction, member, obligation, proposal, task } =
  schema;

export interface UndoPreviewItem {
  activityId: string;
  kind: string;
  summary: string;
}

export interface UndoPreview {
  activityId: string;
  /** False when `blockedReason` applies: the preview still lists what an undo would remove. */
  undoable: boolean;
  blockedReason: string | null;
  willRemove: UndoPreviewItem[];
}

export interface UndoResult {
  undone: UndoPreviewItem[];
  /** The new auto-apply threshold of the undone action's kind and pattern. */
  threshold: number;
}

const ActivityIdInput = z.strictObject({ activityId: z.uuid() });
const CaptureInput = z.strictObject({ captureId: z.uuid() });
const ReassignInput = z.strictObject({ captureId: z.uuid(), matterId: z.uuid() });

function parse<S extends z.ZodType>(inputSchema: S, input: unknown): z.output<S> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid input');
  return parsed.data;
}

const toItem = (row: ActivityRow): UndoPreviewItem => ({
  activityId: row.id,
  kind: row.kind,
  summary: row.summary,
});

async function loadActivity(scope: HandlerScope, activityId: string): Promise<ActivityRow> {
  const [row] = await scope.tx
    .select()
    .from(activity)
    .where(and(eq(activity.workspaceId, scope.actor.workspaceId), eq(activity.id, activityId)))
    .limit(1)
    .for('update');
  if (row === undefined) throw notFound('Activity not found');
  return row;
}

/** Why `row` cannot be undone now, as the error to throw, or null when it can. */
function refusal(row: ActivityRow, now: Date): Error | null {
  if (row.level !== 'L3') {
    return new UndoRefusedError('Only changes the system made on its own can be undone');
  }
  if (row.confirmedAt !== null) {
    return new UndoRefusedError(
      'You confirmed or edited this after it was applied, so it can no longer be undone',
    );
  }
  if (now.getTime() > row.undoExpiresAt.getTime()) return new UndoExpiredError();
  return null;
}

function depthOf(row: ActivityRow, byId: Map<string, ActivityRow>): number {
  let depth = 0;
  let current: ActivityRow | undefined = row;
  while (current?.parentActivityId != null && depth < 100) {
    current = byId.get(current.parentActivityId);
    depth += 1;
  }
  return depth;
}

/** `root` and everything derived from it that is still applied, deepest (newest) first. */
async function cascadeOf(scope: HandlerScope, root: ActivityRow): Promise<ActivityRow[]> {
  if (root.cascadeGroupId === null) return root.undoneAt === null ? [root] : [];
  const group = await scope.tx
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.workspaceId, scope.actor.workspaceId),
        eq(activity.cascadeGroupId, root.cascadeGroupId),
        isNull(activity.undoneAt),
      ),
    )
    .for('update');
  const byId = new Map(group.map((row) => [row.id, row]));
  const included = new Set<string>([root.id]);
  // Everything in the group is derived from its root; below a child, only that child's subtree.
  const rootsGroup = root.parentActivityId === null;
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of group) {
      if (included.has(row.id)) continue;
      const parentIncluded = row.parentActivityId !== null && included.has(row.parentActivityId);
      if (parentIncluded || rootsGroup) {
        included.add(row.id);
        grew = true;
      }
    }
  }
  return group
    .filter((row) => included.has(row.id))
    .sort(
      (a, b) =>
        depthOf(b, byId) - depthOf(a, byId) || b.createdAt.getTime() - a.createdAt.getTime(),
    );
}

/** What an undo of `activityId` would remove, and whether it is allowed. Changes nothing. */
export async function previewUndo(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { activityId: string },
): Promise<UndoPreview> {
  const data = parse(ActivityIdInput, input);
  return inAutomationScope(deps, actor, async (scope) => {
    requireCan(scope, 'matter.write', 'You cannot undo changes');
    const root = await loadActivity(scope, data.activityId);
    if (root.undoneAt !== null) throw conflict('This was already undone');
    const set = await cascadeOf(scope, root);
    const now = scope.now();
    const blocked = set.map((row) => refusal(row, now)).find((e): e is Error => e !== null);
    return {
      activityId: root.id,
      undoable: blocked === undefined,
      blockedReason: blocked?.message ?? null,
      willRemove: set.map(toItem),
    };
  });
}

async function undoRow(scope: HandlerScope, row: ActivityRow): Promise<void> {
  await scope.tx.transaction(async (sp) => {
    const inner: HandlerScope = { ...scope, tx: sp, deps: { ...scope.deps, db: sp } };
    await handlerFor(row.kind as ProposalKind).undo(inner, row);
  });
  await scope.tx
    .update(activity)
    .set({ undoneAt: scope.now(), undoneBy: scope.actor.userId })
    .where(and(eq(activity.workspaceId, scope.actor.workspaceId), eq(activity.id, row.id)));
}

function patternOfActivity(row: ActivityRow): string {
  const pattern = (row.source as { patternKey?: unknown }).patternKey;
  return typeof pattern === 'string' ? pattern : row.kind;
}

/**
 * Reverse an auto-applied action and everything derived from it. Throws `UndoExpiredError` after 7
 * days, and `UndoRefusedError` for an action the lawyer confirmed or edited (or that was a
 * proposal they accepted). Raises the auto-apply threshold of its kind and pattern.
 */
export async function undoActivity(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { activityId: string },
): Promise<UndoResult> {
  const data = parse(ActivityIdInput, input);
  return inAutomationScope(deps, actor, async (scope) => {
    requireCan(scope, 'matter.write', 'You cannot undo changes');
    const root = await loadActivity(scope, data.activityId);
    if (root.undoneAt !== null) throw conflict('This was already undone');
    const now = scope.now();
    const own = refusal(root, now);
    if (own !== null) throw own;
    const set = await cascadeOf(scope, root);
    const blocked = set.map((row) => refusal(row, now)).find((e): e is Error => e !== null);
    if (blocked !== undefined) throw blocked;
    for (const row of set) await undoRow(scope, row);
    const threshold = await raiseThreshold(
      scope.tx,
      scope.actor.workspaceId,
      root.kind as ProposalKind,
      patternOfActivity(root),
    );
    await auditAutomation(
      scope,
      'automation.undone',
      { kind: 'activity', id: root.id },
      {
        activityId: root.id,
        kind: root.kind,
        count: set.length,
      },
    );
    return { undone: set.map(toItem), threshold };
  });
}

/** Record that the lawyer confirmed or edited what the system applied: it can no longer be undone. */
export async function confirmActivity(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { activityId: string },
): Promise<ActivityRow> {
  const data = parse(ActivityIdInput, input);
  return inAutomationScope(deps, actor, async (scope) => {
    requireCan(scope, 'matter.write', 'You cannot confirm changes');
    const root = await loadActivity(scope, data.activityId);
    if (root.undoneAt !== null) throw conflict('This was already undone');
    const [row] = await scope.tx
      .update(activity)
      .set({ confirmedAt: root.confirmedAt ?? scope.now(), confirmedBy: scope.actor.userId })
      .where(and(eq(activity.workspaceId, scope.actor.workspaceId), eq(activity.id, root.id)))
      .returning();
    if (!row) throw new Error('confirmActivity: update returned no row');
    return row;
  });
}

export interface UndoCaptureResult {
  undone: UndoPreviewItem[];
  /** Applied actions left alone: confirmed or edited since, or past the window. */
  skipped: (UndoPreviewItem & { reason: string })[];
}

/** Undo everything the system auto-applied from one capture; what cannot be undone is reported. */
export async function undoCapture(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { captureId: string },
): Promise<UndoCaptureResult> {
  const data = parse(CaptureInput, input);
  return inAutomationScope(deps, actor, async (scope) => {
    requireCan(scope, 'matter.write', 'You cannot undo changes');
    const rows = await scope.tx
      .select()
      .from(activity)
      .where(
        and(
          eq(activity.workspaceId, scope.actor.workspaceId),
          eq(activity.captureId, data.captureId),
          eq(activity.level, 'L3'),
          isNull(activity.undoneAt),
        ),
      )
      .orderBy(desc(activity.createdAt))
      .for('update');
    const byId = new Map(rows.map((row) => [row.id, row]));
    rows.sort((a, b) => depthOf(b, byId) - depthOf(a, byId));
    const now = scope.now();
    const undone: UndoPreviewItem[] = [];
    const skipped: UndoCaptureResult['skipped'] = [];
    for (const row of rows) {
      const blocked = refusal(row, now);
      if (blocked !== null) {
        skipped.push({ ...toItem(row), reason: blocked.message });
        continue;
      }
      await undoRow(scope, row);
      await raiseThreshold(
        scope.tx,
        scope.actor.workspaceId,
        row.kind as ProposalKind,
        patternOfActivity(row),
      );
      undone.push(toItem(row));
    }
    await auditAutomation(
      scope,
      'automation.undone',
      { kind: 'capture', id: data.captureId },
      {
        captureId: data.captureId,
        count: undone.length,
        skipped: skipped.length,
      },
    );
    return { undone, skipped };
  });
}

export interface ReassignResult {
  activityId: string | null;
  moved: { documents: number; tasks: number; obligations: number };
}

function idsOf(rows: ActivityRow[], key: string): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const value = row.entityRefs[key];
    if (Array.isArray(value)) {
      for (const id of value) if (typeof id === 'string') ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Move what a capture produced (its documents, tasks and obligations) to another matter, in one
 * transaction, and record it as a corrected match: the moved rows' `confirmation_state` becomes
 * `corrected`, and the capture's activities count as confirmed by the person (no further undo).
 */
export async function reassignCapture(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { captureId: string; matterId: string },
): Promise<ReassignResult> {
  const data = parse(ReassignInput, input);
  return inAutomationScope(deps, actor, async (scope) => {
    requireCan(scope, 'matter.write', 'You cannot move results between matters');
    const { workspaceId, userId } = scope.actor;
    const [target] = await scope.tx
      .select({
        id: matter.id,
        status: matter.status,
        mergedInto: matter.mergedIntoMatterId,
        ownerUserId: member.userId,
        allowUserIds: matterRestriction.allowedUserIds,
      })
      .from(matter)
      .leftJoin(
        member,
        and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
      )
      .leftJoin(
        matterRestriction,
        and(
          eq(matterRestriction.workspaceId, matter.workspaceId),
          eq(matterRestriction.matterId, matter.id),
        ),
      )
      .where(and(eq(matter.workspaceId, workspaceId), eq(matter.id, data.matterId)))
      .limit(1);
    if (target === undefined) throw notFound('Matter not found');
    const resource = {
      kind: 'matter' as const,
      workspaceId,
      matterId: target.id,
      ...(target.allowUserIds === null
        ? {}
        : { restricted: { allowUserIds: target.allowUserIds } }),
      ...(target.ownerUserId === null ? {} : { ownerUserId: target.ownerUserId }),
    };
    if (!can(scope.member, 'matter.read', resource, scope.deps.settings).allow) {
      throw notFound('Matter not found');
    }
    if (!can(scope.member, 'matter.write', resource, scope.deps.settings).allow) {
      throw forbidden('You cannot change this matter');
    }
    if (target.status === 'archived' || target.mergedInto !== null) {
      throw conflict('The matter is archived or merged');
    }
    const rows = await scope.tx
      .select()
      .from(activity)
      .where(
        and(
          eq(activity.workspaceId, workspaceId),
          eq(activity.captureId, data.captureId),
          isNull(activity.undoneAt),
        ),
      )
      .for('update');
    const documentIds = idsOf(rows, 'documentIds');
    const taskIds = idsOf(rows, 'taskIds');
    const obligationIds = idsOf(rows, 'obligationIds');
    const now = scope.now();
    const previous: Record<string, unknown> = {};
    if (documentIds.length > 0) {
      previous['documents'] = await scope.tx
        .select({ id: document.id, matterId: document.matterId })
        .from(document)
        .where(and(eq(document.workspaceId, workspaceId), inArray(document.id, documentIds)));
      await scope.tx
        .update(document)
        .set({ matterId: target.id, updatedAt: now })
        .where(and(eq(document.workspaceId, workspaceId), inArray(document.id, documentIds)));
    }
    if (taskIds.length > 0) {
      previous['tasks'] = await scope.tx
        .select({ id: task.id, matterId: task.matterId, proceedingId: task.proceedingId })
        .from(task)
        .where(and(eq(task.workspaceId, workspaceId), inArray(task.id, taskIds)));
      await scope.tx
        .update(task)
        .set({
          matterId: target.id,
          proceedingId: null,
          confirmationState: 'corrected',
          updatedAt: now,
        })
        .where(and(eq(task.workspaceId, workspaceId), inArray(task.id, taskIds)));
    }
    if (obligationIds.length > 0) {
      previous['obligations'] = await scope.tx
        .select({
          id: obligation.id,
          matterId: obligation.matterId,
          proceedingId: obligation.proceedingId,
        })
        .from(obligation)
        .where(and(eq(obligation.workspaceId, workspaceId), inArray(obligation.id, obligationIds)));
      await scope.tx
        .update(obligation)
        .set({
          matterId: target.id,
          proceedingId: null,
          confirmationState: 'corrected',
          updatedAt: now,
        })
        .where(and(eq(obligation.workspaceId, workspaceId), inArray(obligation.id, obligationIds)));
    }
    await scope.tx
      .update(proposal)
      .set({ matterId: target.id })
      .where(and(eq(proposal.workspaceId, workspaceId), eq(proposal.captureId, data.captureId)));
    let activityId: string | null = null;
    if (rows.length > 0) {
      await scope.tx
        .update(activity)
        .set({ confirmedAt: now, confirmedBy: userId })
        .where(
          and(
            eq(activity.workspaceId, workspaceId),
            inArray(
              activity.id,
              rows.map((row) => row.id),
            ),
            isNull(activity.confirmedAt),
          ),
        );
      const [created] = await scope.tx
        .insert(activity)
        .values({
          workspaceId,
          captureId: data.captureId,
          kind: 'reassign_capture',
          level: 'L2',
          actor: 'user',
          actorUserId: userId,
          summary: 'Moved the results of a capture to another matter',
          entityRefs: { matterId: target.id, documentIds, taskIds, obligationIds },
          undoPayload: { previous },
          undoExpiresAt: new Date(now.getTime()),
          confirmedAt: now,
          confirmedBy: userId,
          createdAt: now,
        })
        .returning({ id: activity.id });
      activityId = created?.id ?? null;
    }
    await auditAutomation(
      scope,
      'automation.reassigned',
      { kind: 'capture', id: data.captureId },
      {
        captureId: data.captureId,
        matterId: target.id,
        documents: documentIds.length,
        tasks: taskIds.length,
        obligations: obligationIds.length,
      },
    );
    return {
      activityId,
      moved: {
        documents: documentIds.length,
        tasks: taskIds.length,
        obligations: obligationIds.length,
      },
    };
  });
}
