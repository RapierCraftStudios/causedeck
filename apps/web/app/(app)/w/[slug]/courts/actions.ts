'use server';
// Courts server action (#402): add a custom A0 forum to the workspace. `createWorkspaceForumAction`
// goes through `workspaceAction` (lib/workspace-action.ts): zod input, `requireSession`, membership,
// and `workspace.manage` (owners and advocates) asserted by `guard` and again here with
// `assertCan`, so juniors, clerks and viewers get FORBIDDEN. The domain service
// (`@causedeck/core/court` `createWorkspaceForum`) runs on the workspace-scoped transaction `ctx.tx`,
// checks its own permission again and answers CONFLICT for a catalogue forum's (or an existing)
// code. The website becomes the forum's only `config.hosts` entry: links to it open in a new window.
import { assertCan } from '@causedeck/auth/policy';
import { FORUM_CODE_PATTERN } from '@causedeck/validators/forum';
import { JURISDICTION_KINDS } from '@causedeck/validators/matter-graph';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { websiteHost } from '../../../../../lib/forum-input.ts';
import { ActionError, type Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

const LANGUAGE = z.string().regex(/^[a-z]{2}$/);

const CreateForum = WorkspaceScoped.extend({
  code: z.string().trim().regex(FORUM_CODE_PATTERN),
  name: z.string().trim().min(1).max(200),
  jurisdictionKind: z.enum(JURISDICTION_KINDS),
  city: z.string().trim().min(1).max(100),
  primaryLanguage: LANGUAGE,
  secondaryLanguages: z.array(LANGUAGE).max(5).optional(),
  website: z.string().trim().max(253).optional(),
});

export interface CreatedForum {
  id: string;
  code: string;
  court: string;
  seat: string | null;
}

const create = workspaceAction(
  CreateForum,
  async (input, ctx) => {
    assertCan(ctx.actor, 'workspace.manage');
    const website = input.website ?? '';
    const host = website === '' ? null : websiteHost(website);
    if (website !== '' && host === null) {
      throw new ActionError('VALIDATION', 'Enter the court website as an https address.', {
        website: ['Enter the court website as an https address.'],
      });
    }
    const secondary = (input.secondaryLanguages ?? []).filter(
      (language) => language !== input.primaryLanguage,
    );
    const { createWorkspaceForum } = await import('@causedeck/core/court');
    const forum = await createWorkspaceForum(
      ctx.tx,
      { userId: ctx.userId, workspaceId: ctx.workspaceId },
      {
        code: input.code,
        court: input.name,
        seat: input.city,
        jurisdictionKind: input.jurisdictionKind,
        languageProfile: {
          primary: input.primaryLanguage,
          ...(secondary.length > 0 ? { secondary } : {}),
        },
        ...(host === null ? {} : { config: { hosts: [host], deepLinks: {} } }),
      },
    );
    revalidatePath('/w/[slug]/courts', 'page');
    return { id: forum.id, code: forum.code, court: forum.court, seat: forum.seat };
  },
  { action: 'workspace.manage' },
);

export async function createWorkspaceForumAction(raw: unknown): Promise<Result<CreatedForum>> {
  return create(raw);
}
