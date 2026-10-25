'use server';
// Memory screen server actions (#73): confirm, edit, delete, pause one, pause all, dismiss a
// proposal and complete the monthly review. Each goes through `workspaceAction` (strict zod input,
// session, membership, the policy action asserted here and again by the core service) and calls
// `@causedeck/core/memory` on the workspace-scoped transaction. Nothing becomes memory without
// `confirmAction`; the core service owns scope, role and the judge-and-bench guard.
import { assertCan } from '@causedeck/auth/policy';
import { MemoryValue } from '@causedeck/validators';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type Result } from '../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../lib/workspace-action.ts';

const Item = WorkspaceScoped.extend({ itemId: z.uuid(), matterId: z.uuid().nullish() }).strict();
const Confirm = WorkspaceScoped.extend({ proposalId: z.uuid(), value: MemoryValue.optional() }).strict();
const Dismiss = WorkspaceScoped.extend({ proposalId: z.uuid() }).strict();
const Edit = Item.extend({ value: MemoryValue, sharedWithChamber: z.boolean().optional() }).strict();
const Pause = Item.extend({ paused: z.boolean() }).strict();
const PauseAll = WorkspaceScoped.extend({ paused: z.boolean() }).strict();
const Review = WorkspaceScoped.strict();
const Usage = Item;
const AddNote = WorkspaceScoped.extend({
  key: z.enum(['M4.hall_note', 'M4.registry_tip']),
  value: MemoryValue,
}).strict();

export interface MemoryActionResult {
  id: string;
}
export interface UsageResult {
  entries: { id: string; usedIn: 'brief' | 'draft' | 'matching'; outputRef: string | null; usedAt: string }[];
}
export interface ReviewResult {
  completedAt: string;
  activeItems: number;
  pausedItems: number;
}

const deps = (ctx: WorkspaceActionCtx) => ({ db: ctx.tx });
const actor = (ctx: WorkspaceActionCtx) => ({ workspaceId: ctx.workspaceId, userId: ctx.userId });
const options = (matterId: string | null | undefined) =>
  matterId === undefined ? {} : { matterId };
const refresh = () => {
  revalidatePath('/w/[slug]/memory', 'page');
  revalidatePath('/w/[slug]/matters/[id]/memory', 'page');
};

const confirm = workspaceAction(
  Confirm,
  async ({ proposalId, value }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { confirmMemory } = await import('@causedeck/core/memory');
    const item = await confirmMemory(
      deps(ctx),
      actor(ctx),
      proposalId,
      value === undefined ? {} : { value },
    );
    refresh();
    return { id: item.id };
  },
  { action: 'memory.write' },
);

const dismiss = workspaceAction(
  Dismiss,
  async ({ proposalId }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { dismissMemoryProposal } = await import('@causedeck/core/memory');
    await dismissMemoryProposal(deps(ctx), actor(ctx), proposalId);
    refresh();
    return { id: proposalId };
  },
  { action: 'memory.write' },
);

const edit = workspaceAction(
  Edit,
  async ({ itemId, matterId, value, sharedWithChamber }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const core = await import('@causedeck/core/memory');
    await core.editMemory(deps(ctx), actor(ctx), itemId, { value }, options(matterId));
    // Chamber sharing is the owner's alone; the core service refuses anyone else.
    if (sharedWithChamber !== undefined) {
      await core.setSharedWithChamber(deps(ctx), actor(ctx), itemId, sharedWithChamber);
    }
    refresh();
    return { id: itemId };
  },
  { action: 'memory.write' },
);

const remove = workspaceAction(
  Item,
  async ({ itemId, matterId }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { deleteMemory } = await import('@causedeck/core/memory');
    await deleteMemory(deps(ctx), actor(ctx), itemId, options(matterId));
    refresh();
    return { id: itemId };
  },
  { action: 'memory.write' },
);

const pause = workspaceAction(
  Pause,
  async ({ itemId, matterId, paused }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { pauseMemory } = await import('@causedeck/core/memory');
    await pauseMemory(deps(ctx), actor(ctx), itemId, paused, options(matterId));
    refresh();
    return { id: itemId };
  },
  { action: 'memory.write' },
);

const pauseAll = workspaceAction(
  PauseAll,
  async ({ paused }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { setMemoryPauseAll } = await import('@causedeck/core/memory');
    await setMemoryPauseAll(deps(ctx), actor(ctx), paused);
    refresh();
    return { id: ctx.workspaceId };
  },
  { action: 'memory.write' },
);

const usage = workspaceAction(
  Usage,
  async ({ itemId, matterId }, ctx) => {
    assertCan(ctx.actor, 'memory.read');
    const { listMemoryUsage } = await import('@causedeck/core/memory');
    const rows = await listMemoryUsage(deps(ctx), actor(ctx), itemId, options(matterId));
    return {
      entries: rows.map((r) => ({
        id: r.id,
        usedIn: r.usedIn,
        outputRef: r.outputRef,
        usedAt: r.usedAt.toISOString(),
      })),
    };
  },
  { action: 'memory.read' },
);

const addNote = workspaceAction(
  AddNote,
  async ({ key, value }, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { createMemoryNote } = await import('@causedeck/core/memory');
    // A court note is the member's own note: personal scope, and the core guard refuses any text
    // that profiles a judge or a bench.
    const item = await createMemoryNote(deps(ctx), actor(ctx), { key, value, scope: 'user' });
    refresh();
    return { id: item.id };
  },
  { action: 'memory.write' },
);

const completeReview = workspaceAction(
  Review,
  async (_input, ctx) => {
    assertCan(ctx.actor, 'memory.write');
    const { completeMemoryReview } = await import('@causedeck/core/memory');
    const summary = await completeMemoryReview(deps(ctx), actor(ctx));
    refresh();
    return {
      completedAt: summary.completedAt.toISOString(),
      activeItems: summary.activeItems,
      pausedItems: summary.pausedItems,
    };
  },
  { action: 'memory.write' },
);

export async function confirmAction(raw: unknown): Promise<Result<MemoryActionResult>> {
  return confirm(raw);
}
export async function dismissAction(raw: unknown): Promise<Result<MemoryActionResult>> {
  return dismiss(raw);
}
export async function editAction(raw: unknown): Promise<Result<MemoryActionResult>> {
  return edit(raw);
}
export async function deleteAction(raw: unknown): Promise<Result<MemoryActionResult>> {
  return remove(raw);
}
export async function pauseAction(raw: unknown): Promise<Result<MemoryActionResult>> {
  return pause(raw);
}
export async function pauseAllAction(raw: unknown): Promise<Result<MemoryActionResult>> {
  return pauseAll(raw);
}
export async function addNoteAction(raw: unknown): Promise<Result<MemoryActionResult>> {
  return addNote(raw);
}
export async function usageAction(raw: unknown): Promise<Result<UsageResult>> {
  return usage(raw);
}
export async function completeReviewAction(raw: unknown): Promise<Result<ReviewResult>> {
  return completeReview(raw);
}
