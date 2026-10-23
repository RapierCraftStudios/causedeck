'use server';
// Privacy settings server action (#286). `updateWorkspacePrivacyAction` goes through
// `workspaceAction` (lib/workspace-action.ts): zod input (strict, with no India-only AI field, so no
// request can turn it off), `requireSession`, membership, and `workspace.manage` (owners and
// advocates) asserted by `guard` and again here with `assertCan`, so anyone else gets FORBIDDEN. The
// domain service (`@causedeck/core/workspaces` `updateWorkspacePrivacy`) runs on the
// workspace-scoped transaction `ctx.tx`, checks the same permission again and records the
// fail-closed audit event `workspace.privacy_updated` in that transaction.
import { assertCan } from '@causedeck/auth/policy';
import type { PrivacySettings } from '@causedeck/core/workspaces';
import { UpdateWorkspacePrivacyInput } from '@causedeck/validators/workspace';
import { revalidatePath } from 'next/cache';

import type { Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

const UpdatePrivacy = WorkspaceScoped.extend(UpdateWorkspacePrivacyInput.shape).strict();

export type PrivacySettingsView = PrivacySettings;

const update = workspaceAction(
  UpdatePrivacy,
  async ({ sensitiveDefaultRestricted, retentionAudioDays, contributePublicCourtDocuments }, ctx) => {
    assertCan(ctx.actor, 'workspace.manage');
    const { updateWorkspacePrivacy } = await import('@causedeck/core/workspaces');
    const { settings } = await updateWorkspacePrivacy(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      input: { sensitiveDefaultRestricted, retentionAudioDays, contributePublicCourtDocuments },
      requestId: ctx.requestId,
    });
    revalidatePath('/w/[slug]/settings', 'layout');
    return settings;
  },
  { action: 'workspace.manage' },
);

export async function updateWorkspacePrivacyAction(
  raw: unknown,
): Promise<Result<PrivacySettingsView>> {
  return update(raw);
}
