'use server';
// Capture inbox server actions (#43). Each goes through `workspaceAction` (lib/workspace-action.ts):
// strict zod input, `requireSession`, membership and the policy action asserted by `guard` and again
// here. Enabling a channel needs `workspace.manage` and the version of the "where your data goes"
// note the member was shown (CA-9); discarding and pinning need `document.write` and, for a capture
// somebody else made, `workspace.manage`. The domain service (`@causedeck/core/capture`) runs on the
// workspace-scoped transaction `ctx.tx` and audits in it.
import { assertCan } from '@causedeck/auth/policy';
import { CaptureChannelSchema } from '@causedeck/validators';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { objectStore } from '../../../../../lib/storage.ts';
import type { Result } from '../../../../../lib/safe-action.ts';
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
