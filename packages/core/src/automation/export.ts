// What leaves the engine for a person to read (#47): the user-visible activity export, which the
// activity feed (#49) and the data export (#301) use, and the proposals a digest may mention. An
// activity carries its input source, model, version and region (from the linked `ai_call`),
// confidence, level, who confirmed it, when, and its undo state. Proposals and activities about a
// sensitive matter never go into a digest that leaves the workspace (CA-10).
import { schema } from '@causedeck/db';
import { and, desc, eq, gte, inArray, isNull, lt, notInArray, or } from 'drizzle-orm';
import { z } from 'zod';

import type { GraphActor, MatterGraphDeps } from '../matter-graph/index.ts';
import { invalid } from '../shared/errors.ts';

import { inAutomationScope } from './context.ts';
import type { AutomationLevel } from './levels.ts';

const { activity, matter, proceeding, proposal } = schema;

/** The fields of one exported activity, in order. */
export const ACTIVITY_EXPORT_FIELDS = [
  'id',
  'created_at',
  'kind',
  'level',
  'actor',
  'actor_user_id',
  'summary',
  'input_source',
  'model',
  'model_version',
  'region',
  'confidence',
  'confirmed_by',
  'confirmed_at',
  'undo_payload',
  'undo_expires_at',
  'undone_at',
  'undone_by',
  'parent_activity_id',
  'cascade_group_id',
  'capture_id',
] as const;

export interface ActivityExportRow {
  id: string;
  created_at: string;
  kind: string;
  level: AutomationLevel;
  actor: 'system' | 'user';
  actor_user_id: string | null;
  summary: string;
  input_source: string | null;
  model: string | null;
  model_version: string | null;
  region: string | null;
  confidence: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  undo_payload: Record<string, unknown> | null;
  undo_expires_at: string;
  undone_at: string | null;
  undone_by: string | null;
  parent_activity_id: string | null;
  cascade_group_id: string | null;
  capture_id: string | null;
}

const ExportInput = z.strictObject({
  from: z.date().optional(),
  to: z.date().optional(),
  limit: z.int().min(1).max(1000).default(500),
});

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** The workspace's activities, newest first, in the shape of the user-visible export. */
export async function exportActivities(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { from?: Date; to?: Date; limit?: number } = {},
): Promise<ActivityExportRow[]> {
  const parsed = ExportInput.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { from, to, limit } = parsed.data;
  if (from !== undefined && to !== undefined && from >= to) throw invalid('from must be before to');
  return inAutomationScope(deps, actor, async ({ tx }) => {
    const rows = await tx
      .select()
      .from(activity)
      .where(
        and(
          eq(activity.workspaceId, actor.workspaceId),
          from === undefined ? undefined : gte(activity.createdAt, from),
          to === undefined ? undefined : lt(activity.createdAt, to),
        ),
      )
      .orderBy(desc(activity.createdAt), desc(activity.id))
      .limit(limit);
    return rows.map((row): ActivityExportRow => {
      const source = row.source as { input?: unknown; aiCall?: Record<string, unknown> };
      return {
        id: row.id,
        created_at: row.createdAt.toISOString(),
        kind: row.kind,
        level: row.level,
        actor: row.actor,
        actor_user_id: row.actorUserId,
        summary: row.summary,
        input_source: str(source.input),
        model: str(source.aiCall?.['model']),
        model_version: str(source.aiCall?.['modelVersion']),
        region: str(source.aiCall?.['region']),
        confidence: row.confidence,
        confirmed_by: row.confirmedBy,
        confirmed_at: iso(row.confirmedAt),
        undo_payload: row.undoPayload,
        undo_expires_at: row.undoExpiresAt.toISOString(),
        undone_at: iso(row.undoneAt),
        undone_by: row.undoneBy,
        parent_activity_id: row.parentActivityId,
        cascade_group_id: row.cascadeGroupId,
        capture_id: row.captureId,
      };
    });
  });
}

export interface DigestProposal {
  id: string;
  kind: string;
  level: AutomationLevel;
  needsYou: boolean;
  createdAt: Date;
}

/**
 * The open proposals a digest that leaves the workspace (email, push) may count or name: those
 * about a sensitive matter are left out, whether the proposal names the matter or only a proceeding
 * of it. Ids and kinds only, never payloads.
 */
export async function listProposalsForDigest(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { since?: Date } = {},
): Promise<DigestProposal[]> {
  return inAutomationScope(deps, actor, async ({ tx }) => {
    const sensitiveMatter = tx
      .select({ id: matter.id })
      .from(matter)
      .where(and(eq(matter.workspaceId, actor.workspaceId), eq(matter.sensitive, true)));
    const sensitiveProceeding = tx
      .select({ id: proceeding.id })
      .from(proceeding)
      .where(
        and(
          eq(proceeding.workspaceId, actor.workspaceId),
          inArray(proceeding.matterId, sensitiveMatter),
        ),
      );
    return tx
      .select({
        id: proposal.id,
        kind: proposal.kind,
        level: proposal.level,
        needsYou: proposal.needsYou,
        createdAt: proposal.createdAt,
      })
      .from(proposal)
      .where(
        and(
          eq(proposal.workspaceId, actor.workspaceId),
          eq(proposal.status, 'proposed'),
          input.since === undefined ? undefined : gte(proposal.createdAt, input.since),
          or(isNull(proposal.matterId), notInArray(proposal.matterId, sensitiveMatter)),
          or(isNull(proposal.proceedingId), notInArray(proposal.proceedingId, sensitiveProceeding)),
        ),
      )
      .orderBy(desc(proposal.createdAt))
      .limit(500);
  });
}
