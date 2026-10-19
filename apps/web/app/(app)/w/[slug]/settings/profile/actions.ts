'use server';
// Workspace profile server action (#284). `updateWorkspaceProfile` goes through `workspaceAction`
// (lib/workspace-action.ts): zod input, `requireSession`, membership, and `workspace.manage`
// (advocates and owners) asserted by `guard`. A slug change also asserts `workspace.rename`
// (owners only) before any write, so a non-owner gets FORBIDDEN. The domain service
// (`@causedeck/core/workspaces` `updateWorkspaceProfile`) runs on the workspace-scoped transaction
// `ctx.tx`, checks the same permissions again and records the audit events
// (`workspace.profile_updated`, `workspace.slug_renamed`) in that transaction.
import { assertCan } from '@causedeck/auth/policy';
import type { WorkspaceProfileView } from '@causedeck/core/workspaces';
import { UpdateWorkspaceProfileInput } from '@causedeck/validators/workspace';
import { revalidatePath } from 'next/cache';

import type { Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

const UpdateProfile = WorkspaceScoped.extend(UpdateWorkspaceProfileInput.shape);

export type ProfileView = WorkspaceProfileView;

const update = workspaceAction(
  UpdateProfile,
  async ({ name, kind, timezone, locale, practiceCity, slug }, ctx) => {
    const { getWorkspaceProfile, toProfileView, updateWorkspaceProfile } =
      await import('@causedeck/core/workspaces');
    if (slug !== undefined) {
      const current = await getWorkspaceProfile(ctx.tx, ctx.workspaceId);
      if (current !== null && current.slug.toLowerCase() !== slug) {
        assertCan(ctx.actor, 'workspace.rename');
      }
    }
    const { profile } = await updateWorkspaceProfile(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      input: {
        name,
        kind,
        timezone,
        locale,
        practiceCity,
        ...(slug === undefined ? {} : { slug }),
      },
      requestId: ctx.requestId,
    });
    revalidatePath('/w/[slug]/settings', 'layout');
    return toProfileView(profile);
  },
  { action: 'workspace.manage' },
);

export async function updateWorkspaceProfileAction(raw: unknown): Promise<Result<ProfileView>> {
  return update(raw);
}
