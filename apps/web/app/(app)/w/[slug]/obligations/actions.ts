'use server';
// Obligation queue server actions (#68): close (always with a reason), reschedule (a date and a
// reason), reassign, add a task and use a drafted next step. Each goes through `workspaceAction`
// (strict zod input, session, membership, the policy action asserted here and again by the core
// service) and calls `@causedeck/core/obligations` on the workspace-scoped transaction. None of
// them sends, files or pays anything: a letter next step is only an internal task (a draft).
import { assertCan } from '@causedeck/auth/policy';
import { OBLIGATION_CLOSED_REASON_TYPES } from '@causedeck/validators/matter-graph';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type Result } from '../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../lib/workspace-action.ts';

const text = z.string().trim().min(1).max(2000);
const Target = WorkspaceScoped.extend({ obligationId: z.uuid() }).strict();
const Close = Target.extend({
  reason: z.enum(OBLIGATION_CLOSED_REASON_TYPES),
  note: text.optional(),
}).strict();
const Reschedule = Target.extend({ dueDate: z.iso.date(), reason: text }).strict();
const Reassign = Target.extend({ ownerMemberId: z.uuid() }).strict();
const Add = WorkspaceScoped.extend({
  matterId: z.uuid(),
  description: text.max(300),
  dueDate: z.iso.date().nullable(),
  ownerMemberId: z.uuid(),
}).strict();
const UseStep = WorkspaceScoped.extend({
  type: z.enum(['task', 'reminder', 'letter']),
  text: text.max(300),
  matterId: z.uuid(),
  dueDate: z.iso.date().nullable(),
  ownerMemberId: z.uuid(),
}).strict();

export interface ObligationResult {
  id: string;
  status: string;
  dueDate: string | null;
}

const deps = (ctx: WorkspaceActionCtx) => ({ db: ctx.tx });
const actor = (ctx: WorkspaceActionCtx) => ({
  workspaceId: ctx.workspaceId,
  userId: ctx.userId,
});
const view = (row: { id: string; status: string; dueDate: string | null }): ObligationResult => ({
  id: row.id,
  status: row.status,
  dueDate: row.dueDate,
});
const refresh = () => {
  revalidatePath('/w/[slug]/obligations', 'page');
};

const close = workspaceAction(
  Close,
  async ({ obligationId, reason, note }, ctx) => {
    assertCan(ctx.actor, 'obligation.read');
    const { closeObligation } = await import('@causedeck/core/obligations');
    const row = await closeObligation(deps(ctx), actor(ctx), obligationId, {
      reason,
      ...(note === undefined ? {} : { note }),
    });
    refresh();
    return view(row);
  },
  { action: 'obligation.read' },
);

const reschedule = workspaceAction(
  Reschedule,
  async ({ obligationId, dueDate, reason }, ctx) => {
    assertCan(ctx.actor, 'obligation.read');
    const { updateObligation } = await import('@causedeck/core/obligations');
    const row = await updateObligation(deps(ctx), actor(ctx), obligationId, { dueDate, reason });
    refresh();
    return view(row);
  },
  { action: 'obligation.read' },
);

const reassign = workspaceAction(
  Reassign,
  async ({ obligationId, ownerMemberId }, ctx) => {
    assertCan(ctx.actor, 'obligation.read');
    const { updateObligation } = await import('@causedeck/core/obligations');
    const row = await updateObligation(deps(ctx), actor(ctx), obligationId, { ownerMemberId });
    refresh();
    return view(row);
  },
  { action: 'obligation.read' },
);

async function addTask(
  ctx: WorkspaceActionCtx,
  input: { matterId: string; description: string; dueDate: string | null; ownerMemberId: string },
) {
  const { createObligation } = await import('@causedeck/core/obligations');
  const row = await createObligation(deps(ctx), actor(ctx), {
    ...input,
    source: 'internal',
    provenance: { sourceType: 'manual' },
  });
  refresh();
  return view(row);
}

const add = workspaceAction(
  Add,
  async ({ matterId, description, dueDate, ownerMemberId }, ctx) => {
    assertCan(ctx.actor, 'obligation.track');
    return addTask(ctx, { matterId, description, dueDate, ownerMemberId });
  },
  { action: 'obligation.track' },
);

/**
 * "Use" on a next step: a task or an internal reminder is created at once; a client letter is kept
 * as an internal task (a draft) until the letter drafts of #69 land. Nothing is sent.
 */
const nextStep = workspaceAction(
  UseStep,
  async ({ type, text: body, matterId, dueDate, ownerMemberId }, ctx) => {
    assertCan(ctx.actor, 'obligation.track');
    const prefix =
      type === 'letter' ? 'Draft letter to client: ' : type === 'reminder' ? 'Remind clerk: ' : '';
    return addTask(ctx, {
      matterId,
      dueDate,
      ownerMemberId,
      description: `${prefix}${body}`.slice(0, 300),
    });
  },
  { action: 'obligation.track' },
);

export async function closeObligationAction(raw: unknown): Promise<Result<ObligationResult>> {
  return close(raw);
}
export async function rescheduleAction(raw: unknown): Promise<Result<ObligationResult>> {
  return reschedule(raw);
}
export async function reassignAction(raw: unknown): Promise<Result<ObligationResult>> {
  return reassign(raw);
}
export async function addObligationAction(raw: unknown): Promise<Result<ObligationResult>> {
  return add(raw);
}
export async function useNextStepAction(raw: unknown): Promise<Result<ObligationResult>> {
  return nextStep(raw);
}
