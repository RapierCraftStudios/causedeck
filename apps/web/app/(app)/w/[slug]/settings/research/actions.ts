'use server';
// Research provider template actions (#80): a lawyer's own https link templates (SCC Online,
// Manupatra) for the matter link-out menu. `workspace.manage` at the action; core validates the
// template again (https only, no userinfo or port, `{q}` after the host) and the actor's role.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { Result } from '../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../lib/workspace-action.ts';

const actorOf = (ctx: WorkspaceActionCtx) => ({
  workspaceId: ctx.workspaceId,
  userId: ctx.userId,
});

export interface ProviderView {
  key: string;
  label: string;
  urlTemplate: string;
  enabled: boolean;
}

const save = workspaceAction(
  WorkspaceScoped.extend({
    key: z.string().max(40),
    label: z.string().max(80),
    urlTemplate: z.string().max(500),
    enabled: z.boolean().optional(),
  }),
  async (input, ctx): Promise<ProviderView> => {
    const { saveProviderTemplate } = await import('@causedeck/core/research');
    const row = await saveProviderTemplate(ctx.tx, actorOf(ctx), {
      key: input.key,
      label: input.label,
      urlTemplate: input.urlTemplate,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    });
    revalidatePath('/w/[slug]/settings/research', 'page');
    return row;
  },
  { action: 'workspace.manage' },
);

export async function saveProviderTemplateAction(raw: unknown): Promise<Result<ProviderView>> {
  return save(raw);
}

const remove = workspaceAction(
  WorkspaceScoped.extend({ key: z.string().max(40) }),
  async (input, ctx): Promise<{ removed: true }> => {
    const { removeProviderTemplate } = await import('@causedeck/core/research');
    await removeProviderTemplate(ctx.tx, actorOf(ctx), input.key);
    revalidatePath('/w/[slug]/settings/research', 'page');
    return { removed: true };
  },
  { action: 'workspace.manage' },
);

export async function removeProviderTemplateAction(raw: unknown): Promise<Result<{ removed: true }>> {
  return remove(raw);
}
