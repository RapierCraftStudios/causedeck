'use server';
// Integrations server action (#287). `rotateIntegrationTokenAction` goes through `workspaceAction`
// (lib/workspace-action.ts): strict zod input (the kind only), `requireSession`, membership, and
// `workspace.manage` (owners and advocates) asserted by `guard` and again here with `assertCan`, so
// anyone else gets FORBIDDEN. A kind whose feature flag is off is NOT_FOUND, like a dark route. The
// domain service (`@causedeck/core/workspaces` `rotateIntegrationToken`) runs on the
// workspace-scoped transaction `ctx.tx`, checks the same permission again, stores only the new
// token's hash (so the old token stops working) and records the fail-closed audit event
// `workspace.integration_token_rotated` in that transaction. The full address or URL is returned
// here once and never stored or logged.
import { assertCan } from '@causedeck/auth/policy';
import { RotateIntegrationTokenInput } from '@causedeck/validators/workspace';
import { revalidatePath } from 'next/cache';

import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

import { INTEGRATION_FLAGS, integrationValue, type IntegrationKind } from './integration-values.ts';

const Rotate = WorkspaceScoped.extend(RotateIntegrationTokenInput.shape).strict();

export interface RotatedIntegration {
  kind: IntegrationKind;
  /** The full intake address or feed URL. Shown once: it is not stored anywhere. */
  value: string;
  createdAt: Date;
  rotatedAt: Date | null;
}

const rotate = workspaceAction(
  Rotate,
  async ({ kind }, ctx) => {
    assertCan(ctx.actor, 'workspace.manage');
    const { isEnabled } = await import('@causedeck/flags/server');
    const on = await isEnabled(INTEGRATION_FLAGS[kind], {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    });
    if (!on) throw new ActionError('NOT_FOUND', '');
    const { rotateIntegrationToken } = await import('@causedeck/core/workspaces');
    const { serverEnv } = await import('../../../../../../lib/env.ts');
    const result = await rotateIntegrationToken(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      kind,
      requestId: ctx.requestId,
    });
    revalidatePath('/w/[slug]/settings', 'layout');
    return {
      kind,
      value: integrationValue(kind, result.token, serverEnv().APP_URL),
      createdAt: result.createdAt,
      rotatedAt: result.rotatedAt,
    };
  },
  { action: 'workspace.manage' },
);

export async function rotateIntegrationTokenAction(
  raw: unknown,
): Promise<Result<RotatedIntegration>> {
  return rotate(raw);
}
