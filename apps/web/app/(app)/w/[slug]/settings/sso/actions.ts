'use server';
// SSO provider settings actions (#683). Owner-only: `workspaceAction` asserts `member.role` (owners)
// and the core service (`@causedeck/core/workspaces`) checks ownership again and records the
// fail-closed `sso.provider_*` audit event in the same transaction. Nothing returned carries the
// provider's `config` (client secret, certificate).
import { assertCan } from '@causedeck/auth/policy';
import type { SsoProviderSummary } from '@causedeck/core/workspaces';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { serverEnv } from '../../../../../../lib/env.ts';
import type { Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

export type SsoProviderView = Omit<SsoProviderSummary, 'createdAt' | 'updatedAt'>;

const SaveProvider = WorkspaceScoped.extend({
  providerId: z.uuid().optional(),
  protocol: z.enum(['saml', 'oidc']),
  issuer: z.string().trim().min(1).max(500),
  domain: z.string().trim().min(1).max(253),
  enabled: z.boolean(),
  /** Omitted to keep the stored settings (for example when only the enabled flag changes). */
  settings: z.record(z.string(), z.unknown()).optional(),
});

const DeleteProvider = WorkspaceScoped.extend({ providerId: z.uuid() });

const save = workspaceAction(
  SaveProvider,
  async (input, ctx) => {
    assertCan(ctx.actor, 'member.role');
    const { saveSsoProvider } = await import('@causedeck/core/workspaces');
    const row = await saveSsoProvider(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
      protocol: input.protocol,
      issuer: input.issuer,
      domain: input.domain,
      enabled: input.enabled,
      ...(input.settings === undefined ? {} : { settings: input.settings }),
      baseUrl: serverEnv().APP_URL,
      requestId: ctx.requestId,
    });
    revalidatePath('/w/[slug]/settings/sso', 'page');
    return {
      id: row.id,
      protocol: row.protocol,
      issuer: row.issuer,
      domain: row.domain,
      enabled: row.enabled,
    };
  },
  { action: 'member.role' },
);

const remove = workspaceAction(
  DeleteProvider,
  async ({ providerId }, ctx) => {
    assertCan(ctx.actor, 'member.role');
    const { deleteSsoProvider } = await import('@causedeck/core/workspaces');
    await deleteSsoProvider(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      providerId,
      requestId: ctx.requestId,
    });
    revalidatePath('/w/[slug]/settings/sso', 'page');
    return { id: providerId };
  },
  { action: 'member.role' },
);

export async function saveSsoProviderAction(raw: unknown): Promise<Result<SsoProviderView>> {
  return save(raw);
}

export async function deleteSsoProviderAction(raw: unknown): Promise<Result<{ id: string }>> {
  return remove(raw);
}
