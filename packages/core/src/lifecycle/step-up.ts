// The owner + step-up gate of the lifecycle entry points (#304; docs/engineering/data-lifecycle.md
// "Step-up authentication"). `requestExport`, `requestWorkspaceDeletion` and
// `cancelWorkspaceDeletion` run `requireOwner` and then `assertStepUp` inside their transaction;
// `requestAccountDeletion` runs `assertStepUp` only (it is self-service). Internal to lifecycle:
// not re-exported from index.ts.
//
// A refusal rolls the service transaction back, so the gate records it afterwards, on `ctx.db`:
// a role refusal as `access.denied` (members on the workspace chain, anyone else account-level, as
// `recordAccessDenied` does) and a stale or missing step-up as `auth.step_up_required`. A failed
// audit write is logged and never masks the FORBIDDEN.
import {
  isStepUpRequiredError,
  requireStepUp,
  STEP_UP_MAX_AGE_MS,
  STEP_UP_REQUIRED,
} from '@causedeck/auth/step-up';
import type { Queryable } from '@causedeck/db';
import { createLogger, type Logger } from '@causedeck/observability';

import { record } from '../audit/index.ts';
import { memberRole, WorkspaceError } from '../workspaces/index.ts';

/** The lifecycle actions behind the gate, as named in audit metadata (`deniedAction`). */
export type GatedAction =
  'export.request' | 'workspace.delete' | 'workspace.delete_cancel' | 'account.delete';

export interface StepUpGateCtx {
  db: Queryable;
  /** `null` for account deletion. */
  workspaceId: string | null;
  userId: string;
  /** The caller's Better Auth session id. */
  sessionId: string;
  requestId?: string;
  userAgent?: string;
  ip?: string;
  now?: () => Date;
}

let log: Logger | undefined;
const logger = (): Logger => (log ??= createLogger({ service: 'lifecycle' }));

const STEP_UP_MESSAGE = 'Confirm it is you with your passkey or authenticator code';

/** The `FORBIDDEN` a stale or missing step-up surfaces as; `reason` tells the UI to re-verify. */
export class StepUpForbiddenError extends WorkspaceError {
  readonly reason = STEP_UP_REQUIRED;

  constructor() {
    super('FORBIDDEN', STEP_UP_MESSAGE);
  }
}

/** Throw `StepUpRequiredError` unless the caller's session verified a passkey or TOTP recently. */
export async function assertStepUp(
  tx: Queryable,
  ctx: Pick<StepUpGateCtx, 'sessionId' | 'userId' | 'now'>,
): Promise<void> {
  await requireStepUp(
    {
      db: tx,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      ...(ctx.now === undefined ? {} : { now: ctx.now }),
    },
    { maxAgeMs: STEP_UP_MAX_AGE_MS },
  );
}

const requestFields = (ctx: StepUpGateCtx) => ({
  ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
  ...(ctx.userAgent === undefined ? {} : { userAgent: ctx.userAgent }),
  ...(ctx.ip === undefined ? {} : { ip: ctx.ip }),
});

async function recordRefusal(
  ctx: StepUpGateCtx,
  action: GatedAction,
  stepUp: boolean,
): Promise<void> {
  try {
    if (stepUp) {
      // The caller passed the owner check (or needs none), so an owner's refusal belongs to the
      // workspace chain; account deletion is account-level.
      await record(
        {
          db: ctx.db,
          workspaceId: ctx.workspaceId,
          actor: { userId: ctx.userId, kind: 'user' },
          ...requestFields(ctx),
        },
        {
          action: 'auth.step_up_required',
          outcome: 'denied',
          ...(ctx.workspaceId === null
            ? {}
            : { target: { kind: 'workspace', id: ctx.workspaceId } }),
          metadata: { deniedAction: action },
        },
      );
      return;
    }
    if (ctx.workspaceId === null) return;
    // A non-member must not write into a chain it has no access to (`recordAccessDenied`).
    const member = (await memberRole(ctx.db, ctx.userId, ctx.workspaceId)) !== null;
    await record(
      {
        db: ctx.db,
        workspaceId: member ? ctx.workspaceId : null,
        actor: { userId: ctx.userId, kind: 'user' },
        ...requestFields(ctx),
      },
      {
        action: 'access.denied',
        target: { kind: 'workspace', id: ctx.workspaceId },
        outcome: 'denied',
        metadata: { member, deniedAction: action, reason: 'role' },
      },
    );
  } catch (error) {
    logger().error(
      { err: { name: error instanceof Error ? error.name : 'unknown' }, deniedAction: action },
      'lifecycle refusal not recorded',
    );
  }
}

/**
 * Run `body` (the service's transaction, which calls `requireOwner` and `assertStepUp`). A role or
 * step-up refusal is audited after the rollback and rethrown as `FORBIDDEN`; anything else passes
 * through unchanged.
 */
export async function auditedGate<T>(
  ctx: StepUpGateCtx,
  action: GatedAction,
  body: () => Promise<T>,
): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isStepUpRequiredError(error)) {
      await recordRefusal(ctx, action, true);
      throw new StepUpForbiddenError();
    }
    if (error instanceof WorkspaceError && error.code === 'FORBIDDEN') {
      await recordRefusal(ctx, action, false);
    }
    throw error;
  }
}
