// Step-up authentication (#304, part 4 of #31): owner-only lifecycle actions (export, workspace
// deletion and its cancellation, account deletion) need a passkey or TOTP verification in the
// current session within the last 10 minutes. `createAuth` (server.ts) stamps `session.step_up_at`
// when a passkey or TOTP ceremony creates a session or a signed-in user verifies TOTP again;
// `requireStepUp` reads it. Magic link, Google, backup codes and email OTP never count.
// See docs/engineering/data-lifecycle.md "Step-up authentication".
import type { Queryable } from '@causedeck/db';
import { schema } from '@causedeck/db';
import { and, eq, gt } from 'drizzle-orm';

/** How recent the last passkey or TOTP verification must be: 10 minutes. */
export const STEP_UP_MAX_AGE_MS = 600_000;

export const STEP_UP_REQUIRED = 'step_up_required' as const;

/** No fresh passkey or TOTP verification in this session. Maps to `FORBIDDEN`. */
export class StepUpRequiredError extends Error {
  readonly code = 'FORBIDDEN' as const;
  readonly reason = STEP_UP_REQUIRED;

  constructor(message = 'Confirm it is you with your passkey or authenticator code') {
    super(message);
    this.name = 'StepUpRequiredError';
  }
}

export function isStepUpRequiredError(error: unknown): error is StepUpRequiredError {
  return error instanceof StepUpRequiredError;
}

export interface StepUpCtx {
  db: Queryable;
  sessionId: string;
  userId: string;
  now?: () => Date;
}

/** True when `stepUpAt` lies in `[now - maxAgeMs, now]`, exclusive of the far boundary. */
export function isFreshStepUp(stepUpAt: Date | null, now: Date, maxAgeMs: number): boolean {
  if (stepUpAt === null) return false;
  const age = now.getTime() - stepUpAt.getTime();
  return age >= 0 && age < maxAgeMs;
}

/**
 * Throw `StepUpRequiredError` unless `sessionId` is a live session of `userId` whose last passkey
 * or TOTP verification is younger than `maxAgeMs`. A future stamp is not fresh either.
 */
export async function requireStepUp(
  ctx: StepUpCtx,
  { maxAgeMs = STEP_UP_MAX_AGE_MS }: { maxAgeMs?: number } = {},
): Promise<void> {
  const now = ctx.now?.() ?? new Date();
  const { session } = schema;
  const [row] = await ctx.db
    .select({ stepUpAt: session.stepUpAt })
    .from(session)
    .where(
      and(
        eq(session.id, ctx.sessionId),
        eq(session.userId, ctx.userId),
        gt(session.expiresAt, now),
      ),
    )
    .limit(1);
  if (row === undefined || !isFreshStepUp(row.stepUpAt, now, maxAgeMs)) {
    throw new StepUpRequiredError();
  }
}

/** Stamp `sessionId`'s step-up time (a signed-in user just verified TOTP again). */
export async function markStepUp(db: Queryable, sessionId: string, at: Date): Promise<void> {
  const { session } = schema;
  await db.update(session).set({ stepUpAt: at }).where(eq(session.id, sessionId));
}
