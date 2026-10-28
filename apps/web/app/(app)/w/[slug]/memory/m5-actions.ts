'use server';
// M5 (playbooks and precedent bank) server actions (#903). Each goes through `workspaceAction`
// (strict zod input, session, membership, the policy action asserted here and again by the core
// service) and calls `@causedeck/core/memory` on the workspace-scoped transaction. A precedent is
// saved only by `confirmPrecedentAction` (the generic confirm would skip the passage and its
// vector); a dismissal always carries a reason code and rests the passage for 30 days.
import { assertCan } from '@causedeck/auth/policy';
import { PlaybookSchema, PrecedentDismissReason } from '@causedeck/validators';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type Result } from '../../../../../lib/safe-action.ts';
import { memoryDeps } from '../../../../../lib/memory/deps.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../lib/workspace-action.ts';

const ConfirmPrecedent = WorkspaceScoped.extend({
  proposalId: z.uuid(),
  text: z.string().trim().min(1).max(20_000).optional(),
}).strict();
const DismissPrecedent = WorkspaceScoped.extend({
  proposalId: z.uuid(),
  reason: PrecedentDismissReason,
}).strict();
const ProposePlaybook = WorkspaceScoped.extend({ playbook: PlaybookSchema }).strict();
const ConfirmPlaybook = WorkspaceScoped.extend({ proposalId: z.uuid() }).strict();
const Item = WorkspaceScoped.extend({ itemId: z.uuid() }).strict();

export interface M5ActionResult {
  id: string;
}

const deps = (ctx: WorkspaceActionCtx) => memoryDeps(ctx.tx);
const actor = (ctx: WorkspaceActionCtx) => ({ workspaceId: ctx.workspaceId, userId: ctx.userId });
const refresh = () => {
  revalidatePath('/w/[slug]/memory', 'page');
  revalidatePath('/w/[slug]/memory/precedents', 'page');
  revalidatePath('/w/[slug]/memory/playbooks', 'page');
  revalidatePath('/w/[slug]/memory/review', 'page');
};

const confirmPrecedent = workspaceAction(
  ConfirmPrecedent,
  async ({ proposalId, text }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { confirmPrecedentProposal } = await import('@causedeck/core/memory');
    const saved = await confirmPrecedentProposal(
      deps(ctx),
      actor(ctx),
      proposalId,
      text === undefined ? {} : { text },
    );
    refresh();
    return { id: saved.passageId };
  },
  { action: 'memory.write' },
);

const dismissPrecedent = workspaceAction(
  DismissPrecedent,
  async ({ proposalId, reason }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { dismissPrecedentProposal } = await import('@causedeck/core/memory');
    await dismissPrecedentProposal(deps(ctx), actor(ctx), proposalId, reason);
    refresh();
    return { id: proposalId };
  },
  { action: 'memory.write' },
);

const proposePlaybook = workspaceAction(
  ProposePlaybook,
  async ({ playbook }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { proposePlaybook: propose } = await import('@causedeck/core/memory');
    const proposal = await propose(deps(ctx), actor(ctx), playbook);
    refresh();
    // Null when memory is paused: nothing was filed.
    return { id: proposal?.id ?? '' };
  },
  { action: 'memory.write' },
);

const confirmPlaybook = workspaceAction(
  ConfirmPlaybook,
  async ({ proposalId }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { confirmPlaybook: confirm } = await import('@causedeck/core/memory');
    const saved = await confirm(deps(ctx), actor(ctx), proposalId);
    refresh();
    return { id: saved.itemId };
  },
  { action: 'memory.write' },
);

const deletePlaybook = workspaceAction(
  Item,
  async ({ itemId }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { deletePlaybook: remove } = await import('@causedeck/core/memory');
    await remove(deps(ctx), actor(ctx), itemId);
    refresh();
    return { id: itemId };
  },
  { action: 'memory.write' },
);

const retirePrecedent = workspaceAction(
  Item,
  async ({ itemId }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { retirePrecedent: retire } = await import('@causedeck/core/memory');
    await retire(deps(ctx), actor(ctx), itemId);
    refresh();
    return { id: itemId };
  },
  { action: 'memory.write' },
);

const deletePrecedent = workspaceAction(
  Item,
  async ({ itemId }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { deletePrecedent: remove } = await import('@causedeck/core/memory');
    await remove(deps(ctx), actor(ctx), itemId);
    refresh();
    return { id: itemId };
  },
  { action: 'memory.write' },
);

export async function confirmPrecedentAction(raw: unknown): Promise<Result<M5ActionResult>> {
  return confirmPrecedent(raw);
}
export async function dismissPrecedentAction(raw: unknown): Promise<Result<M5ActionResult>> {
  return dismissPrecedent(raw);
}
export async function proposePlaybookAction(raw: unknown): Promise<Result<M5ActionResult>> {
  return proposePlaybook(raw);
}
export async function confirmPlaybookAction(raw: unknown): Promise<Result<M5ActionResult>> {
  return confirmPlaybook(raw);
}
export async function deletePlaybookAction(raw: unknown): Promise<Result<M5ActionResult>> {
  return deletePlaybook(raw);
}
export async function retirePrecedentAction(raw: unknown): Promise<Result<M5ActionResult>> {
  return retirePrecedent(raw);
}
export async function deletePrecedentAction(raw: unknown): Promise<Result<M5ActionResult>> {
  return deletePrecedent(raw);
}
