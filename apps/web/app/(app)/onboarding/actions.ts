'use server';
// Create a workspace from `/onboarding` (#179). Not workspace-scoped (the workspace does not exist
// yet), so it uses `safeAction` with `requireSession` directly rather than `workspaceAction`
// (lib/workspace-action.ts). The domain service makes the creator `owner` and writes the
// organization, membership and settings rows in one transaction.
import { CreateWorkspaceInput } from '@causedeck/validators/workspace';

import type { AppSession } from '../../../lib/auth.ts';
import { safeAction, type Result } from '../../../lib/safe-action.ts';
import { toActionError } from '../../../lib/workspace-action.ts';

async function requireSession(): Promise<AppSession> {
  const auth = await import('../../../lib/auth.ts');
  return auth.requireSession();
}

const create = safeAction(
  CreateWorkspaceInput,
  async (input, ctx) => {
    const session = ctx.session as AppSession;
    const { createWorkspaceFor } = await import('@causedeck/core/runtime');
    try {
      const workspace = await createWorkspaceFor({ userId: session.user.id, input });
      return { slug: workspace.slug };
    } catch (error) {
      throw toActionError(error);
    }
  },
  { getSession: requireSession },
);

// authz: public — any signed-in user may create a workspace (`requireSession` above); there is
// no workspace to authorize against yet.
export async function createWorkspaceAction(raw: unknown): Promise<Result<{ slug: string }>> {
  return create(raw);
}
