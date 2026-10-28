// Draft access (#768). A draft is the lawyer's own work on a matter, so every read, write and export
// needs the matter to be readable by the actor (NOT_FOUND otherwise, like every matter service) and
// then `draft.read`, `draft.write` or `draft.export` (a clerk has none; FORBIDDEN). A draft without
// a matter is workspace-level: only the role check applies. The role is taken from the active
// membership row, never from the caller. Same access pattern as `research/notes-service.ts`.
import { isRole } from '@causedeck/auth';
import { can, type Action, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import {
  currentScope,
  isUuid,
  schema,
  withWorkspace,
  type Queryable,
  type Transaction,
} from '@causedeck/db';
import { and, eq, sql } from 'drizzle-orm';

import { forbidden, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

const { draft, matter, member } = schema;

export type DraftAction = Extract<Action, 'draft.read' | 'draft.write' | 'draft.export'>;

/** Who is asking; the role, if given, is replaced by the active membership's role. */
export type DraftActor = Omit<Actor, 'role'> & Partial<Pick<Actor, 'role'>>;

export type DraftRow = typeof draft.$inferSelect;

export const draftNotFound = () => notFound('Draft not found');

/** The user id owning the matter, for a junior's "matters they own" visibility. */
const matterOwnerUserId = sql`(select ${member.userId} from ${member} where ${member.organizationId} = ${matter.workspaceId} and ${member.id} = ${matter.ownerMemberId})`;

export async function mayReadMatter(
  tx: Transaction,
  reader: Actor,
  settings: PolicySettings,
  matterId: string,
): Promise<boolean> {
  if (!can(reader, 'matter.read', undefined, settings).allow) return false;
  const rows = await tx
    .select({ id: matter.id })
    .from(matter)
    .where(
      and(
        eq(matter.workspaceId, reader.workspaceId),
        eq(matter.id, matterId),
        matterVisibilityPredicate(reader, matter.id, { settings, ownerUserId: matterOwnerUserId }),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Run `fn` as the actor's active membership in their own workspace; NOT_FOUND for any other. */
export async function asDraftMember<T>(
  db: Queryable,
  actor: DraftActor,
  fn: (tx: Transaction, reader: Actor, settings: PolicySettings) => Promise<T>,
): Promise<T> {
  const { workspaceId, userId } = actor;
  if (!isUuid(workspaceId) || !isUuid(userId)) throw draftNotFound();
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw draftNotFound();
  }
  return withWorkspace(db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw draftNotFound();
    const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
    return fn(tx, { ...actor, role }, settings);
  });
}

/** FORBIDDEN unless the role may take `action`. */
export function requireDraftAction(
  reader: Actor,
  settings: PolicySettings,
  action: DraftAction,
): void {
  if (!can(reader, action, undefined, settings).allow) {
    throw forbidden('You cannot use drafts');
  }
}

/** A matter the actor may read, then `action`; NOT_FOUND for an unreadable matter. */
export async function requireMatterAccess(
  tx: Transaction,
  reader: Actor,
  settings: PolicySettings,
  matterId: string | null,
  action: DraftAction,
): Promise<void> {
  if (matterId !== null && !(await mayReadMatter(tx, reader, settings, matterId))) {
    throw draftNotFound();
  }
  requireDraftAction(reader, settings, action);
}

/** The draft, if it is in the workspace and its matter is readable; NOT_FOUND otherwise. */
export async function requireDraft(
  tx: Transaction,
  reader: Actor,
  settings: PolicySettings,
  draftId: string,
  action: DraftAction,
): Promise<DraftRow> {
  if (!isUuid(draftId)) throw draftNotFound();
  const [row] = await tx
    .select()
    .from(draft)
    .where(and(eq(draft.workspaceId, reader.workspaceId), eq(draft.id, draftId)))
    .limit(1);
  if (row === undefined) throw draftNotFound();
  await requireMatterAccess(tx, reader, settings, row.matterId, action);
  return row;
}
