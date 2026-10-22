// The staff console's read-only workspace view (#314, part of #27; spike §6). During a granted
// `view` session, the admin app shows the workspace as its members see it in settings: the profile
// and who is in it. Both reads go through `ctx.supportSession.read` (`settings.read`, which the
// advocate-level staff actor may do), so each is re-checked against the session, run on a
// rolled-back savepoint and audited as `support.view` with the workspace as target. Members come
// back without email or last-active time: the minimum a support conversation needs.
import {
  getWorkspaceProfile,
  listMembers,
  type WorkspaceProfile,
  type WorkspaceRole,
} from '../workspaces/index.ts';
import { withSupportSession } from './access.ts';
import type { StaffContext, SupportSession } from './sessions.ts';

export interface SupportViewMember {
  name: string;
  role: WorkspaceRole;
  joinedAt: Date;
}

export interface SupportWorkspaceView {
  session: SupportSession;
  profile: WorkspaceProfile | null;
  members: SupportViewMember[];
}

/**
 * The workspace profile and members, read through the support context. Throws
 * `SupportSessionInactiveError` without a granted, unexpired session of this staff member, and a
 * `FORBIDDEN` (audited as denied) for a `metadata` session.
 */
export async function readSupportWorkspaceView(
  ctx: StaffContext,
  workspaceId: string,
): Promise<SupportWorkspaceView> {
  const { supportSession } = await withSupportSession(ctx, workspaceId);
  const targets = [{ kind: 'workspace', id: workspaceId }] as const;
  const profile = await supportSession.read('settings.read', targets, (tx) =>
    getWorkspaceProfile(tx, workspaceId),
  );
  const members = await supportSession.read('settings.read', targets, async (tx) =>
    (await listMembers(tx, workspaceId)).map(({ name, role, joinedAt }) => ({
      name,
      role,
      joinedAt,
    })),
  );
  return { session: supportSession.supportSession, profile, members };
}
