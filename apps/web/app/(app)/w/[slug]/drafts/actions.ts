'use server';
// Create-draft server action (#826). Goes through `workspaceAction` (zod input, session, membership,
// `draft.write`); core `createDraft` runs on the workspace-scoped transaction `ctx.tx` and decides
// again (matter access, template enabled). It only creates a draft from a template: nothing is
// sent, shared or filed, and no draft text is logged.
import { z } from 'zod';

import type { Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

export interface CreatedDraft {
  id: string;
}

const CreateDraft = WorkspaceScoped.extend({
  templateId: z.uuid(),
  matterId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
});

const create = workspaceAction(
  CreateDraft,
  async (input, ctx) => {
    const { createDraft } = await import('@causedeck/core/drafting');
    const created = await createDraft({ db: ctx.tx }, ctx.actor, {
      templateId: input.templateId,
      matterId: input.matterId ?? null,
      title: input.title,
    });
    return { id: created.draft.id };
  },
  { action: 'draft.write' },
);

// A `'use server'` module may only export async functions, so the action is wrapped.
export async function createDraftAction(raw: unknown): Promise<Result<CreatedDraft>> {
  return create(raw);
}
