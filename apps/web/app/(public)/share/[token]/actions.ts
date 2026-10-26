'use server';
// Claim a shared brief and import its matter (#507). Not workspace-scoped: the caller may have no
// workspace yet, so it uses `safeAction` with `requireSession`, like the invite accept. The matter
// goes into the caller's first workspace; a dead link comes back as `rejected`.
import { AcceptInviteInput } from '@causedeck/validators/workspace';

import type { AppSession } from '../../../../lib/auth.ts';
import { safeAction, type Result } from '../../../../lib/safe-action.ts';
import { toActionError } from '../../../../lib/workspace-action.ts';

export type ImportShareOutcome =
  | { status: 'imported'; next: string; credited: boolean }
  | { status: 'rejected'; reason: 'INVALID' | 'NO_WORKSPACE' };

async function requireSession(): Promise<AppSession> {
  const auth = await import('../../../../lib/auth.ts');
  return auth.requireSession();
}

const importShare = safeAction(
  AcceptInviteInput,
  async ({ token }, ctx): Promise<ImportShareOutcome> => {
    const session = ctx.session as AppSession;
    const { db, listMembershipsFor } = await import('@causedeck/core/runtime');
    const { claimBriefShare, importSharedMatter } = await import('@causedeck/core/shares');
    const [workspace] = await listMembershipsFor(session.user.id);
    if (workspace === undefined) return { status: 'rejected', reason: 'NO_WORKSPACE' };
    try {
      await claimBriefShare(db, { userId: session.user.id, token });
      const imported = await importSharedMatter(
        { db, events: { emit: () => undefined } },
        { userId: session.user.id, workspaceId: workspace.workspaceId },
        token,
      );
      return {
        status: 'imported',
        next: `/w/${encodeURIComponent(workspace.slug)}/matters/${imported.matterId}`,
        credited: imported.credit?.granted === true,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'WorkspaceError') {
        const code = (error as Error & { code?: unknown }).code;
        if (code === 'NOT_FOUND') return { status: 'rejected', reason: 'INVALID' };
      }
      throw toActionError(error);
    }
  },
  { getSession: requireSession },
);

// authz: public — the caller is not a member of the sharing workspace; the token is the capability
// and the matter is created in the caller's own workspace, where `createMatter` checks the role.
export async function importSharedBriefAction(raw: unknown): Promise<Result<ImportShareOutcome>> {
  return importShare(raw);
}
