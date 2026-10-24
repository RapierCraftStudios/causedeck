'use server';
// Research tab server actions (#497, D-048). Each goes through `workspaceAction`: zod input,
// session, membership and `matter.write`; the research services decide again per matter and return
// NOT_FOUND or FORBIDDEN through `toActionError`. A tag the lawyer adds is confirmed at once;
// proposed tags (AI) become alert sources only through `confirmTagAction`.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { Result } from '../../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../../lib/workspace-action.ts';

function actorOf(ctx: WorkspaceActionCtx) {
  return { workspaceId: ctx.workspaceId, userId: ctx.userId };
}

function revalidateResearch(): void {
  revalidatePath('/w/[slug]/matters/[id]/research', 'page');
}

export interface TagResult {
  id: string;
  status: string;
}

const AddTag = WorkspaceScoped.extend({
  matterId: z.uuid(),
  statute: z.string().trim().min(1).max(200),
  section: z.string().trim().max(50).optional(),
  issue: z.string().trim().max(500).optional(),
});

const add = workspaceAction(
  AddTag,
  async (input, ctx) => {
    const { addTag } = await import('@causedeck/core/research');
    const row = await addTag(ctx.tx, actorOf(ctx), {
      matterId: input.matterId,
      statute: input.statute,
      ...(input.section === undefined ? {} : { section: input.section }),
      ...(input.issue === undefined ? {} : { issue: input.issue }),
    });
    revalidateResearch();
    return { id: row.id, status: row.status };
  },
  { action: 'matter.write' },
);

export async function addTagAction(raw: unknown): Promise<Result<TagResult>> {
  return add(raw);
}

const TagRef = WorkspaceScoped.extend({ matterId: z.uuid(), tagId: z.uuid() });

const confirm = workspaceAction(
  TagRef,
  async (input, ctx) => {
    const { confirmTag } = await import('@causedeck/core/research');
    const row = await confirmTag(ctx.tx, actorOf(ctx), {
      matterId: input.matterId,
      tagId: input.tagId,
    });
    revalidateResearch();
    return { id: row.id, status: row.status };
  },
  { action: 'matter.write' },
);

export async function confirmTagAction(raw: unknown): Promise<Result<TagResult>> {
  return confirm(raw);
}

const dismiss = workspaceAction(
  TagRef,
  async (input, ctx) => {
    const { dismissTag } = await import('@causedeck/core/research');
    const row = await dismissTag(ctx.tx, actorOf(ctx), {
      matterId: input.matterId,
      tagId: input.tagId,
    });
    revalidateResearch();
    return { id: row.id, status: row.status };
  },
  { action: 'matter.write' },
);

export async function dismissTagAction(raw: unknown): Promise<Result<TagResult>> {
  return dismiss(raw);
}
