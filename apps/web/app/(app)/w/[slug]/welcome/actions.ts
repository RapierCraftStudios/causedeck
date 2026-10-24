'use server';
// Clerk-led onboarding server actions (#505). Both go through `workspaceAction`
// (lib/workspace-action.ts): zod input, `requireSession`, membership. Asking for approval is the
// clerk's own act (the domain service answers FORBIDDEN to anyone who is not a clerk here);
// approving needs `workspace.manage`, asserted by `guard`, and the service checks it again. Neither
// changes what a clerk may do: the status is information only.
import type { ClerkSetup } from '@causedeck/core/workspaces';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

export interface ClerkSetupView {
  memberId: string;
  status: 'pending' | 'approved' | null;
}

const toView = (setup: ClerkSetup): ClerkSetupView => ({
  memberId: setup.memberId,
  status: setup.status,
});

const RequestApproval = WorkspaceScoped.strict();
const ApproveSetup = WorkspaceScoped.extend({ memberId: z.uuid() }).strict();

const request = workspaceAction(RequestApproval, async (_input, ctx) => {
  const { requestClerkSetupApproval } = await import('@causedeck/core/workspaces');
  const setup = await requestClerkSetupApproval(ctx.tx, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
  });
  revalidatePath('/w/[slug]/welcome', 'page');
  return toView(setup);
});

const approve = workspaceAction(
  ApproveSetup,
  async ({ memberId }, ctx) => {
    const { approveClerkSetup } = await import('@causedeck/core/workspaces');
    const setup = await approveClerkSetup(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      memberId,
    });
    revalidatePath('/w/[slug]/welcome', 'page');
    return toView(setup);
  },
  { action: 'workspace.manage' },
);

export async function requestClerkSetupApprovalAction(
  raw: unknown,
): Promise<Result<ClerkSetupView>> {
  return request(raw);
}

export async function approveClerkSetupAction(raw: unknown): Promise<Result<ClerkSetupView>> {
  return approve(raw);
}
