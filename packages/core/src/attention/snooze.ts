// Snooze, dismiss and lift (#70): only a person acts, never the detector. A snooze hides a rule (or
// every rule) on a matter until a day and needs a reason; a dismissal marks the matter
// "intentionally dormant" until it gets a new event. Each write is audited with ids, the rule and
// the day, never the reason. Needs `matter.write` on a matter the actor may read; a viewer or a
// clerk reads flags but cannot silence them. The workspace threshold needs `workspace.manage`.
import { can } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import { schema } from '@causedeck/db';
import {
  LiftSnoozeInput,
  Snooze,
  StaleDaysInput,
  type SnoozeRecord,
} from '@causedeck/validators/attention';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { record, type AuditAction, type AuditMetadataValue } from '../audit/index.ts';
import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { localDay } from '../obligations/index.ts';

import { inAttentionScope, type AttentionActor, type AttentionDeps, type AttentionScope } from './detect.ts';

const { matter, member, attentionSnooze, workspaceSettings } = schema;

function parse<S extends z.ZodType>(schemaOf: S, input: unknown): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return parsed.data;
}

const auditAs = (
  scope: AttentionScope,
  action: AuditAction,
  target: { kind: string; id: string },
  metadata: Record<string, AuditMetadataValue> = {},
) =>
  record(
    {
      db: scope.tx,
      workspaceId: scope.actor.workspaceId,
      actor: { userId: scope.actor.userId, kind: 'user' },
    },
    { action, target, metadata },
  );

/** NOT_FOUND when the actor may not read the matter, FORBIDDEN when they may not change it. */
async function requireWritable(scope: AttentionScope, matterId: string): Promise<void> {
  const [row] = await scope.tx
    .select({ id: matter.id })
    .from(matter)
    .leftJoin(
      member,
      and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
    )
    .where(
      and(
        eq(matter.workspaceId, scope.actor.workspaceId),
        eq(matter.id, matterId),
        matterVisibilityPredicate(scope.actor, matter.id, {
          settings: scope.settings,
          ownerUserId: member.userId,
        }),
      ),
    )
    .limit(1);
  if (row === undefined) throw notFound('Matter not found');
  const resource = { kind: 'matter', workspaceId: scope.actor.workspaceId, matterId };
  if (!can(scope.actor, 'matter.write', resource, scope.settings).allow) {
    throw forbidden('You cannot change this matter');
  }
}

function toRecord(row: typeof attentionSnooze.$inferSelect): SnoozeRecord {
  return {
    id: row.id,
    matterId: row.matterId,
    rule: row.rule,
    until: row.until,
    dismissed: row.dismissed,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Snooze a rule (or all) on a matter until a day, with a reason. */
export async function snoozeFlag(
  deps: AttentionDeps,
  actor: AttentionActor,
  input: Snooze,
): Promise<SnoozeRecord> {
  const data = parse(Snooze, input);
  if (data.kind !== 'snooze') throw invalid('kind: expected a snooze');
  return inAttentionScope(deps, actor, async (scope) => {
    await requireWritable(scope, data.matterId);
    if (data.until < localDay(scope.now, deps.timeZone)) throw invalid('until: must not be in the past');
    const [row] = await scope.tx
      .insert(attentionSnooze)
      .values({
        workspaceId: actor.workspaceId,
        matterId: data.matterId,
        rule: data.rule,
        until: data.until,
        dismissed: false,
        reason: data.reason,
        createdBy: actor.userId,
        createdAt: scope.now,
      })
      .returning();
    if (row === undefined) throw new Error('snoozeFlag: insert returned no row');
    await auditAs(scope, 'attention.snoozed', { kind: 'matter', id: data.matterId }, {
      rule: data.rule ?? 'all',
      until: data.until,
    });
    return toRecord(row);
  });
}

/** Dismiss a rule (or all) on a matter as intentionally dormant. */
export async function dismissFlag(
  deps: AttentionDeps,
  actor: AttentionActor,
  input: Snooze,
): Promise<SnoozeRecord> {
  const data = parse(Snooze, input);
  if (data.kind !== 'dismiss') throw invalid('kind: expected a dismissal');
  return inAttentionScope(deps, actor, async (scope) => {
    await requireWritable(scope, data.matterId);
    const [row] = await scope.tx
      .insert(attentionSnooze)
      .values({
        workspaceId: actor.workspaceId,
        matterId: data.matterId,
        rule: data.rule,
        until: null,
        dismissed: true,
        reason: data.reason ?? null,
        createdBy: actor.userId,
        createdAt: scope.now,
      })
      .returning();
    if (row === undefined) throw new Error('dismissFlag: insert returned no row');
    await auditAs(scope, 'attention.dismissed', { kind: 'matter', id: data.matterId }, {
      rule: data.rule ?? 'all',
    });
    return toRecord(row);
  });
}

/** Lift a snooze or a dismissal; the flags it hid are raised again. */
export async function liftSnooze(
  deps: AttentionDeps,
  actor: AttentionActor,
  input: LiftSnoozeInput,
): Promise<void> {
  const data = parse(LiftSnoozeInput, input);
  return inAttentionScope(deps, actor, async (scope) => {
    const [row] = await scope.tx
      .select()
      .from(attentionSnooze)
      .where(
        and(
          eq(attentionSnooze.workspaceId, actor.workspaceId),
          eq(attentionSnooze.id, data.snoozeId),
        ),
      )
      .limit(1);
    if (row === undefined) throw notFound('Snooze not found');
    try {
      await requireWritable(scope, row.matterId);
    } catch (error) {
      if ((error as { code?: string }).code === 'NOT_FOUND') throw notFound('Snooze not found');
      throw error;
    }
    await scope.tx
      .delete(attentionSnooze)
      .where(
        and(
          eq(attentionSnooze.workspaceId, actor.workspaceId),
          eq(attentionSnooze.id, data.snoozeId),
        ),
      );
    await auditAs(scope, 'attention.lifted', { kind: 'matter', id: row.matterId }, {
      rule: row.rule ?? 'all',
    });
  });
}

/** The snoozes and dismissals on a matter, oldest first (shown on the matter). */
export async function listSnoozes(
  deps: AttentionDeps,
  actor: AttentionActor,
  matterId: string,
): Promise<SnoozeRecord[]> {
  return inAttentionScope(deps, actor, async (scope) => {
    const [visible] = await scope.tx
      .select({ id: matter.id })
      .from(matter)
      .leftJoin(
        member,
        and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
      )
      .where(
        and(
          eq(matter.workspaceId, actor.workspaceId),
          eq(matter.id, matterId),
          matterVisibilityPredicate(scope.actor, matter.id, {
            settings: scope.settings,
            ownerUserId: member.userId,
          }),
        ),
      )
      .limit(1);
    if (visible === undefined) throw notFound('Matter not found');
    const rows = await scope.tx
      .select()
      .from(attentionSnooze)
      .where(
        and(
          eq(attentionSnooze.workspaceId, actor.workspaceId),
          eq(attentionSnooze.matterId, matterId),
        ),
      )
      .orderBy(asc(attentionSnooze.createdAt));
    return rows.map(toRecord);
  });
}

/** Set the workspace's stale-matter threshold in days (7 to 180). */
export async function setStaleDays(
  deps: AttentionDeps,
  actor: AttentionActor,
  input: StaleDaysInput,
): Promise<number> {
  const data = parse(StaleDaysInput, input);
  return inAttentionScope(deps, actor, async (scope) => {
    const resource = { kind: 'workspace', workspaceId: actor.workspaceId };
    if (!can(scope.actor, 'workspace.manage', resource, scope.settings).allow) {
      throw forbidden('Only an owner or advocate can change the threshold');
    }
    const [row] = await scope.tx
      .update(workspaceSettings)
      .set({ attentionStaleDays: data.days })
      .where(eq(workspaceSettings.workspaceId, actor.workspaceId))
      .returning({ days: workspaceSettings.attentionStaleDays });
    if (row === undefined) throw notFound('Workspace settings not found');
    await auditAs(scope, 'attention.threshold_changed', { kind: 'workspace', id: actor.workspaceId }, {
      days: data.days,
    });
    return row.days;
  });
}
