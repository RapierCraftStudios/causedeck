// Eval reuse consent (#558, deferred from #56): `workspace_settings.allow_eval_reuse`. Corrections a
// person makes in the A0 confirmation grid may enter an eval set only when this is true (default
// false: opt-in) and the person also consented to the item. Only owners (`member.role`) set it.
// Each change is audited fail-closed in the caller's transaction with ids only: the action says
// whether reuse was enabled or disabled, the target is the workspace id, and no metadata carries
// customer content. Turning it off also withdraws every per-item consent.
import { schema, type Database, type Transaction } from '@causedeck/db';
import { eq } from 'drizzle-orm';

import { record } from '../audit/index.ts';

import { requireOwner } from './members.ts';

type Queryable = Database | Transaction;

const { workspaceSettings, correction } = schema;

/** Whether the workspace allows eval reuse; false when it has no settings row. */
export async function getAllowEvalReuse(db: Queryable, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ allow: workspaceSettings.allowEvalReuse })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  return row?.allow ?? false;
}

export interface SetAllowEvalReuseRequest {
  workspaceId: string;
  actorUserId: string;
  allow: boolean;
  requestId?: string;
  userAgent?: string;
  ip?: string;
}

/** Owner-only. Returns whether the value changed; saving the current value records nothing. */
export async function setAllowEvalReuse(
  db: Queryable,
  request: SetAllowEvalReuseRequest,
): Promise<{ allowEvalReuse: boolean; changed: boolean }> {
  const { workspaceId, actorUserId, allow } = request;
  return db.transaction(async (tx) => {
    await requireOwner(tx, workspaceId, actorUserId);
    const before = await getAllowEvalReuse(tx, workspaceId);
    if (before === allow) return { allowEvalReuse: allow, changed: false };
    await tx
      .insert(workspaceSettings)
      .values({ workspaceId, allowEvalReuse: allow })
      .onConflictDoUpdate({
        target: workspaceSettings.workspaceId,
        set: { allowEvalReuse: allow },
      });
    if (!allow) {
      await tx
        .update(correction)
        .set({ evalConsent: false })
        .where(eq(correction.workspaceId, workspaceId));
    }
    await record(
      {
        db: tx,
        workspaceId,
        actor: { userId: actorUserId, kind: 'user' as const },
        ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
        ...(request.userAgent === undefined ? {} : { userAgent: request.userAgent }),
        ...(request.ip === undefined ? {} : { ip: request.ip }),
      },
      {
        action: allow ? 'workspace.eval_reuse_enabled' : 'workspace.eval_reuse_disabled',
        target: { kind: 'workspace', id: workspaceId },
      },
    );
    return { allowEvalReuse: allow, changed: true };
  });
}
