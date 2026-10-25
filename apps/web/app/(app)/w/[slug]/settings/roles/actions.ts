'use server';
// Role settings server action (#285). `updateRoleSettings` goes through `workspaceAction`
// (lib/workspace-action.ts): zod input, `requireSession`, membership, and `member.role` (owners
// only) asserted by `guard` and again here with `assertCan`, so anyone else gets FORBIDDEN. The
// domain service (`@causedeck/core/workspaces` `updateRoleSettings`) runs on the workspace-scoped
// transaction `ctx.tx`, checks the same permission again and records the fail-closed audit event
// `workspace.role_settings_updated` in that transaction.
import { assertCan } from '@causedeck/auth/policy';
import type { RoleSettings } from '@causedeck/core/workspaces';
import { UpdateRoleSettingsInput } from '@causedeck/validators/workspace';
import { revalidatePath } from 'next/cache';

import type { Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

const UpdateRoles = WorkspaceScoped.extend(UpdateRoleSettingsInput.shape);

export type RoleSettingsView = RoleSettings;

const update = workspaceAction(
  UpdateRoles,
  async ({ advocatesCanInvite, ownersSeeRestrictedMatters }, ctx) => {
    assertCan(ctx.actor, 'member.role');
    const { updateRoleSettings } = await import('@causedeck/core/workspaces');
    const { settings } = await updateRoleSettings(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      input: { advocatesCanInvite, ownersSeeRestrictedMatters },
      requestId: ctx.requestId,
    });
    revalidatePath('/w/[slug]/settings', 'layout');
    return settings;
  },
  { action: 'member.role' },
);

export async function updateRoleSettingsAction(raw: unknown): Promise<Result<RoleSettingsView>> {
  return update(raw);
}
