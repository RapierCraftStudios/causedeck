'use server';
// Capture inbox server actions (#43). Each goes through `workspaceAction` (lib/workspace-action.ts):
// strict zod input, `requireSession`, membership and the policy action asserted by `guard` and again
// here. The decisions of #48 (accept, edit-and-accept, dismiss, undo, reassign, keep as attachment,
// type the key line, mark sent) call the automation engine (`@causedeck/core/automation`) on that
// same transaction; it decides again with `can()` and an id of another workspace is NOT_FOUND. None
// of them sends, files or pays anything. Enabling a channel needs `workspace.manage` and the version of the "where your data goes"
// note the member was shown (CA-9); discarding and pinning need `document.write` and, for a capture
// somebody else made, `workspace.manage`. The domain service (`@causedeck/core/capture`) runs on the
// workspace-scoped transaction `ctx.tx` and audits in it.
import { assertCan } from '@causedeck/auth/policy';
import { CaptureChannelSchema } from '@causedeck/validators';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { markReadySent } from '../../../../../lib/inbox/ready-providers.ts';
import { graphDeps } from '../../../../../lib/matters/graph-deps.ts';
import { objectStore } from '../../../../../lib/storage.ts';
import { ActionError, type Result } from '../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../lib/workspace-action.ts';

const EnableChannel = WorkspaceScoped.extend({
  channel: CaptureChannelSchema,
  disclosureVersion: z.string().min(1).max(64),
}).strict();

const CaptureTarget = WorkspaceScoped.extend({ captureId: z.uuid() }).strict();
const PinCapture = CaptureTarget.extend({ pinned: z.boolean() }).strict();

export interface ChannelView {
  channel: string;
  enabled: boolean;
  disclosureVersion: string | null;
}

export interface CaptureView {
  captureId: string;
  status: string;
  pinned: boolean;
}

async function captureCtx(ctx: WorkspaceActionCtx) {
  const { captureContext } = await import('@causedeck/core/runtime');
  return captureContext({
    db: ctx.tx,
    store: objectStore(),
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    authorize: (action) => {
      assertCan(ctx.actor, action);
    },
    requestId: ctx.requestId,
  });
}

const enable = workspaceAction(
  EnableChannel,
  async ({ channel, disclosureVersion }, ctx) => {
    assertCan(ctx.actor, 'workspace.manage');
    const { enableChannel } = await import('@causedeck/core/capture');
    const state = await enableChannel(await captureCtx(ctx), { channel, disclosureVersion });
    revalidatePath('/w/[slug]/inbox', 'page');
    return {
      channel: state.channel,
      enabled: state.enabled,
      disclosureVersion: state.disclosureVersion,
    };
  },
  { action: 'workspace.manage' },
);

const discard = workspaceAction(
  CaptureTarget,
  async ({ captureId }, ctx) => {
    const { discardCapture } = await import('@causedeck/core/capture');
    const row = await discardCapture(await captureCtx(ctx), captureId);
    revalidatePath('/w/[slug]/inbox', 'page');
    return { captureId: row.id, status: row.status, pinned: row.pinned };
  },
  { action: 'document.write' },
);

const pin = workspaceAction(
  PinCapture,
  async ({ captureId, pinned }, ctx) => {
    const { pinCapture } = await import('@causedeck/core/capture');
    const row = await pinCapture(await captureCtx(ctx), captureId, pinned);
    revalidatePath('/w/[slug]/inbox', 'page');
    return { captureId: row.id, status: row.status, pinned: row.pinned };
  },
  { action: 'document.write' },
);

export async function enableChannelAction(raw: unknown): Promise<Result<ChannelView>> {
  return enable(raw);
}

export async function discardCaptureAction(raw: unknown): Promise<Result<CaptureView>> {
  return discard(raw);
}

export async function pinCaptureAction(raw: unknown): Promise<Result<CaptureView>> {
  return pin(raw);
}

const ProposalTarget = WorkspaceScoped.extend({ proposalId: z.uuid() }).strict();
const EditProposal = ProposalTarget.extend({
  payload: z.record(z.string().max(60), z.unknown()),
}).strict();
const DismissProposal = ProposalTarget.extend({
  /** "Don't suggest this again". */
  suppress: z.boolean().optional(),
}).strict();
const UndoTarget = WorkspaceScoped.extend({ activityId: z.uuid() }).strict();
const Reassign = CaptureTarget.extend({ matterId: z.uuid() }).strict();
const KeyLine = CaptureTarget.extend({ text: z.string().trim().min(1).max(2000) }).strict();
const MarkSent = WorkspaceScoped.extend({
  providerId: z.string().min(1).max(80),
  itemId: z.string().min(1).max(200),
}).strict();

export interface ResolvedView {
  proposalId: string;
  kind: string;
  /** The activity the decision wrote; `Undo` takes this id. */
  activityId: string | null;
  /** The ISO date a next-date decision set, for the toast and the live region. */
  date: string | null;
}

const actorOf = (ctx: WorkspaceActionCtx) => ({
  workspaceId: ctx.workspaceId,
  userId: ctx.userId,
});

const dateOf = (payload: unknown): string | null => {
  const value =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)['date']
      : undefined;
  return typeof value === 'string' ? value : null;
};

const accept = workspaceAction(
  ProposalTarget,
  async ({ proposalId }, ctx): Promise<ResolvedView> => {
    const { acceptProposal } = await import('@causedeck/core/automation');
    const done = await acceptProposal(graphDeps(ctx.tx), actorOf(ctx), { proposalId });
    revalidatePath('/w/[slug]/inbox', 'page');
    return {
      proposalId,
      kind: done.proposal.kind,
      activityId: done.activity.id,
      date: done.proposal.kind === 'next_date' ? dateOf(done.proposal.payload) : null,
    };
  },
  { action: 'matter.write' },
);

const editAccept = workspaceAction(
  EditProposal,
  async ({ proposalId, payload }, ctx): Promise<ResolvedView> => {
    const { editAndAccept } = await import('@causedeck/core/automation');
    const done = await editAndAccept(graphDeps(ctx.tx), actorOf(ctx), { proposalId, payload });
    revalidatePath('/w/[slug]/inbox', 'page');
    return {
      proposalId,
      kind: done.proposal.kind,
      activityId: done.activity.id,
      date: done.proposal.kind === 'next_date' ? dateOf(done.proposal.payload) : null,
    };
  },
  { action: 'matter.write' },
);

const dismiss = workspaceAction(
  DismissProposal,
  async ({ proposalId, suppress }, ctx): Promise<ResolvedView> => {
    const { dismissProposal } = await import('@causedeck/core/automation');
    const row = await dismissProposal(graphDeps(ctx.tx), actorOf(ctx), {
      proposalId,
      ...(suppress === true ? { reason: 'dont_suggest_again' } : {}),
    });
    revalidatePath('/w/[slug]/inbox', 'page');
    return { proposalId, kind: row.kind, activityId: null, date: null };
  },
  { action: 'matter.write' },
);

const undo = workspaceAction(
  UndoTarget,
  async ({ activityId }, ctx) => {
    const { undoActivity } = await import('@causedeck/core/automation');
    const result = await undoActivity(graphDeps(ctx.tx), actorOf(ctx), { activityId });
    revalidatePath('/w/[slug]/inbox', 'page');
    return { undone: result.undone.length };
  },
  { action: 'matter.write' },
);

const reassign = workspaceAction(
  Reassign,
  async ({ captureId, matterId }, ctx) => {
    const { reassignCapture } = await import('@causedeck/core/automation');
    const result = await reassignCapture(graphDeps(ctx.tx), actorOf(ctx), { captureId, matterId });
    revalidatePath('/w/[slug]/inbox', 'page');
    return { activityId: result.activityId, moved: result.moved };
  },
  { action: 'matter.write' },
);

const keepAttachment = workspaceAction(
  CaptureTarget,
  async ({ captureId }, ctx): Promise<CaptureView> => {
    const { keepCaptureAsAttachment } = await import('@causedeck/core/capture');
    const row = await keepCaptureAsAttachment(await captureCtx(ctx), captureId);
    revalidatePath('/w/[slug]/inbox', 'page');
    return { captureId: row.id, status: row.status, pinned: row.pinned };
  },
  { action: 'document.write' },
);

const typeKeyLine = workspaceAction(
  KeyLine,
  async ({ captureId, text }, ctx) => {
    const { createKeyLineCapture } = await import('@causedeck/core/capture');
    const result = await createKeyLineCapture(await captureCtx(ctx), { captureId, text });
    revalidatePath('/w/[slug]/inbox', 'page');
    return result;
  },
  { action: 'document.write' },
);

const markSent = workspaceAction(
  MarkSent,
  async ({ providerId, itemId }, ctx) => {
    const found = await markReadySent(actorOf(ctx), providerId, itemId);
    if (!found) throw new ActionError('NOT_FOUND', 'Draft not found');
    revalidatePath('/w/[slug]/inbox', 'page');
    return { itemId };
  },
  { action: 'matter.write' },
);

export async function acceptProposalAction(raw: unknown): Promise<Result<ResolvedView>> {
  return accept(raw);
}

export async function editAcceptProposalAction(raw: unknown): Promise<Result<ResolvedView>> {
  return editAccept(raw);
}

export async function dismissProposalAction(raw: unknown): Promise<Result<ResolvedView>> {
  return dismiss(raw);
}

export async function undoActivityAction(raw: unknown): Promise<Result<{ undone: number }>> {
  return undo(raw);
}

export async function reassignCaptureAction(
  raw: unknown,
): Promise<Result<{ activityId: string | null; moved: Record<string, number> }>> {
  return reassign(raw);
}

export async function keepAsAttachmentAction(raw: unknown): Promise<Result<CaptureView>> {
  return keepAttachment(raw);
}

export async function typeKeyLineAction(
  raw: unknown,
): Promise<Result<{ captureId: string; linkedCaptureId: string }>> {
  return typeKeyLine(raw);
}

export async function markSentAction(raw: unknown): Promise<Result<{ itemId: string }>> {
  return markSent(raw);
}
