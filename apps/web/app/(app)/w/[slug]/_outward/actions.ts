'use server';
// Outward draft server actions (#736): prepare a draft, save the lawyer's edit, record that the
// lawyer shared it. Each goes through `workspaceAction` (strict zod input, session, membership,
// `draft.write` asserted here and again by the core service, which also applies the matter's
// visibility) and calls `@causedeck/core/outward` on the workspace-scoped transaction. None of them
// sends anything: sharing is the lawyer's own copy, `wa.me` / `mailto:` link or download, and
// `markDraftSharedAction` only logs that they did it (ADR 0045).
import { assertCan } from '@causedeck/auth/policy';
import { Audience, Language, ShareChannel, Tone } from '@causedeck/validators/outward-draft';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { memoryDeps } from '../../../../../lib/memory/deps.ts';
import { type Result } from '../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../lib/workspace-action.ts';

const Compose = WorkspaceScoped.extend({
  matterId: z.uuid(),
  hearingId: z.uuid().optional(),
  orderId: z.uuid().optional(),
  audience: Audience,
  language: Language.optional(),
  tone: Tone.optional(),
  clientPersonId: z.uuid().optional(),
}).strict();
const Edit = WorkspaceScoped.extend({ draftId: z.uuid(), body: z.string() }).strict();
const Share = WorkspaceScoped.extend({ draftId: z.uuid(), channel: ShareChannel }).strict();

export interface ComposedView {
  draftId: string;
  templateOnly: boolean;
}
export interface EditedView {
  versionId: string;
  warnings: string[];
}
export interface SharedView {
  shareId: string;
  channel: string;
}

const deps = (ctx: WorkspaceActionCtx) => ({ db: ctx.tx });
/** Compose also reads the lawyer's memory (#74): tone, sign-off and client language. */
const composeDeps = (ctx: WorkspaceActionCtx) => ({ db: ctx.tx, memory: memoryDeps(ctx.tx) });
const actor = (ctx: WorkspaceActionCtx) => ({ workspaceId: ctx.workspaceId, userId: ctx.userId });
const refresh = () => {
  revalidatePath('/w/[slug]/drafts', 'page');
  revalidatePath('/w/[slug]/inbox', 'page');
};

const compose = workspaceAction(
  Compose,
  async (input, ctx) => {
    const request: Omit<typeof input, 'workspaceId'> & { workspaceId?: string } = { ...input };
    delete request.workspaceId;
    assertCan(ctx.actor, 'draft.write');
    const { composeUpdate } = await import('@causedeck/core/outward');
    const draft = await composeUpdate(composeDeps(ctx), actor(ctx), request);
    refresh();
    return { draftId: draft.draftId, templateOnly: draft.templateOnly };
  },
  { action: 'draft.write' },
);

const edit = workspaceAction(
  Edit,
  async ({ draftId, body }, ctx) => {
    assertCan(ctx.actor, 'draft.write');
    const { saveEdit } = await import('@causedeck/core/outward');
    const saved = await saveEdit(deps(ctx), actor(ctx), { draftId, body });
    refresh();
    return { versionId: saved.versionId, warnings: saved.warnings };
  },
  { action: 'draft.write' },
);

const share = workspaceAction(
  Share,
  async ({ draftId, channel }, ctx) => {
    assertCan(ctx.actor, 'draft.write');
    const { recordShared } = await import('@causedeck/core/outward');
    const shared = await recordShared(deps(ctx), actor(ctx), { draftId, channel });
    refresh();
    return { shareId: shared.shareId, channel: shared.channel };
  },
  { action: 'draft.write' },
);

export async function composeDraftAction(raw: unknown): Promise<Result<ComposedView>> {
  return compose(raw);
}
export async function saveDraftEditAction(raw: unknown): Promise<Result<EditedView>> {
  return edit(raw);
}
export async function markDraftSharedAction(raw: unknown): Promise<Result<SharedView>> {
  return share(raw);
}
