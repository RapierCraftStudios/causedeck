// Audit for the automation engine (#47; docs/product/09 §6): every submit, apply, accept, dismiss,
// undo and reassign writes an `audit_event` through the audit writer (#26), with ids, kind, level
// and counts only. The model, version and region of an AI-derived action are read from the linked
// `ai_call` row (written by the AI gateway): the engine never takes them from the caller.
import { schema, type Transaction } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import { record, type AuditAction, type AuditMetadataValue } from '../audit/index.ts';

import type { HandlerScope } from './types.ts';

/** The model details of an `ai_call`, as an activity's `source` keeps them (no content, no prompt). */
export interface AiCallModelSource {
  aiCallId: string;
  provider: string;
  model: string;
  modelVersion: string | null;
  region: string;
  purpose: string;
}

/** Write one automation audit event for the acting user (or the system, for an unasked L3 apply). */
export async function auditAutomation(
  scope: HandlerScope,
  action: AuditAction,
  target: { kind: string; id: string } | undefined,
  metadata: Record<string, AuditMetadataValue> = {},
  actorKind: 'user' | 'system' = 'user',
): Promise<void> {
  await record(
    {
      db: scope.tx,
      workspaceId: scope.actor.workspaceId,
      actor: { userId: scope.actor.userId, kind: actorKind },
    },
    { action, ...(target === undefined ? {} : { target }), metadata },
  );
}

/** The `ai_call` row's model, version and region, or null when it is not this workspace's. */
export async function readAiCall(
  tx: Transaction,
  workspaceId: string,
  aiCallId: string,
): Promise<AiCallModelSource | null> {
  const { aiCall } = schema;
  const [row] = await tx
    .select({
      provider: aiCall.provider,
      model: aiCall.model,
      modelVersion: aiCall.modelVersion,
      region: aiCall.region,
      purpose: aiCall.purpose,
    })
    .from(aiCall)
    .where(and(eq(aiCall.workspaceId, workspaceId), eq(aiCall.id, aiCallId)))
    .limit(1);
  return row === undefined ? null : { aiCallId, ...row };
}
