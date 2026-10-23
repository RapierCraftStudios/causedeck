'use server';
// Email intake server actions (#54 part 2). Each goes through `workspaceAction`
// (lib/workspace-action.ts): strict zod input, `requireSession`, membership, and `workspace.manage`
// (owners and advocates) asserted by `guard` and again here with `assertCan`, so anyone else gets
// FORBIDDEN. While the `capture.email-forward` flag is off every action is NOT_FOUND, like a dark
// route. The domain service (`@causedeck/core/email-intake`) runs on the workspace-scoped
// transaction `ctx.tx`, checks the permission again and audits fail-closed in that transaction.
// The intake address is shown in full: only its owner and the workspace admins can read it, and a
// rotated or revoked address stops resolving at once.
import { assertCan } from '@causedeck/auth/policy';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { serverEnv } from '../../../../../../../lib/env.ts';
import { objectStore } from '../../../../../../../lib/storage.ts';
import { ActionError, type Result } from '../../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../../lib/workspace-action.ts';

const ScopeOnly = WorkspaceScoped.strict();
const AddressTarget = WorkspaceScoped.extend({ addressId: z.uuid() }).strict();
const AddAllowlist = WorkspaceScoped.extend({
  pattern: z.string().trim().min(1).max(254),
  kind: z.string().min(1).max(32),
  label: z.string().trim().max(80).optional(),
}).strict();
const EntryTarget = WorkspaceScoped.extend({ entryId: z.uuid() }).strict();

export interface AddressResult {
  id: string;
  address: string;
  createdAt: Date;
}

export interface AllowlistEntryResult {
  id: string;
  pattern: string;
  kind: string;
  label: string | null;
  isDomain: boolean;
  createdAt: Date;
}

export interface ChannelResult {
  enabled: boolean;
  disclosureVersion: string | null;
}

/** A dark route: NOT_FOUND until `capture.email-forward` is on for the workspace. */
async function requireFlag(ctx: WorkspaceActionCtx): Promise<void> {
  const { isEnabled } = await import('@causedeck/flags/server');
  const on = await isEnabled('capture.email-forward', {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  });
  if (!on) throw new ActionError('NOT_FOUND', '');
}

async function intakeCtx(ctx: WorkspaceActionCtx) {
  await requireFlag(ctx);
  assertCan(ctx.actor, 'workspace.manage');
  return {
    db: ctx.tx,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    // Addresses live at the app's host, as the #287 address did.
    domain: new URL(serverEnv().APP_URL).hostname,
    authorize: (action: 'workspace.manage') => {
      assertCan(ctx.actor, action);
    },
    requestId: ctx.requestId,
  };
}

function revalidate(): void {
  revalidatePath('/w/[slug]/settings/integrations/email', 'page');
}

const create = workspaceAction(
  ScopeOnly,
  async (_input, ctx) => {
    const { createAddress } = await import('@causedeck/core/email-intake');
    const row = await createAddress(await intakeCtx(ctx));
    revalidate();
    return { id: row.id, address: row.address, createdAt: row.createdAt };
  },
  { action: 'workspace.manage' },
);

const rotate = workspaceAction(
  ScopeOnly,
  async (_input, ctx) => {
    const { rotateAddress } = await import('@causedeck/core/email-intake');
    const row = await rotateAddress(await intakeCtx(ctx));
    revalidate();
    return { id: row.id, address: row.address, createdAt: row.createdAt };
  },
  { action: 'workspace.manage' },
);

const revoke = workspaceAction(
  AddressTarget,
  async ({ addressId }, ctx) => {
    const { revokeAddress } = await import('@causedeck/core/email-intake');
    await revokeAddress(await intakeCtx(ctx), addressId);
    revalidate();
    return { addressId };
  },
  { action: 'workspace.manage' },
);

const addEntry = workspaceAction(
  AddAllowlist,
  async ({ pattern, kind, label }, ctx) => {
    const { addAllowlistEntry } = await import('@causedeck/core/email-intake');
    const row = await addAllowlistEntry(await intakeCtx(ctx), {
      pattern,
      kind,
      ...(label === undefined ? {} : { label }),
    });
    revalidate();
    return {
      id: row.id,
      pattern: row.pattern,
      kind: row.kind,
      label: row.label,
      isDomain: row.isDomain,
      createdAt: row.createdAt,
    };
  },
  { action: 'workspace.manage' },
);

const removeEntry = workspaceAction(
  EntryTarget,
  async ({ entryId }, ctx) => {
    const { removeAllowlistEntry } = await import('@causedeck/core/email-intake');
    await removeAllowlistEntry(await intakeCtx(ctx), entryId);
    revalidate();
    return { entryId };
  },
  { action: 'workspace.manage' },
);

const enableChannel = workspaceAction(
  ScopeOnly,
  async (_input, ctx) => {
    await requireFlag(ctx);
    assertCan(ctx.actor, 'workspace.manage');
    const { captureContext } = await import('@causedeck/core/runtime');
    const { enableEmailChannel } = await import('@causedeck/core/email-intake');
    const state = await enableEmailChannel(
      await captureContext({
        db: ctx.tx,
        store: objectStore(),
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        authorize: (action) => {
          assertCan(ctx.actor, action);
        },
        requestId: ctx.requestId,
      }),
    );
    revalidate();
    return { enabled: state.enabled, disclosureVersion: state.disclosureVersion };
  },
  { action: 'workspace.manage' },
);

export async function createIntakeAddressAction(raw: unknown): Promise<Result<AddressResult>> {
  return create(raw);
}

export async function rotateIntakeAddressAction(raw: unknown): Promise<Result<AddressResult>> {
  return rotate(raw);
}

export async function revokeIntakeAddressAction(
  raw: unknown,
): Promise<Result<{ addressId: string }>> {
  return revoke(raw);
}

export async function addIntakeAllowlistEntryAction(
  raw: unknown,
): Promise<Result<AllowlistEntryResult>> {
  return addEntry(raw);
}

export async function removeIntakeAllowlistEntryAction(
  raw: unknown,
): Promise<Result<{ entryId: string }>> {
  return removeEntry(raw);
}

export async function enableEmailChannelAction(raw: unknown): Promise<Result<ChannelResult>> {
  return enableChannel(raw);
}
