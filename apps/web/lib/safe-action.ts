// Server-action wrapper (spike §3): validate input with zod, run the handler, and always resolve to
// a typed result. Raw errors never reach the client; unknown failures are logged and become INTERNAL.
import { randomUUID } from 'node:crypto';

import { UnauthenticatedError } from '@causedeck/auth';
import type { AuthSession } from '@causedeck/auth/session';
import type { ZodType } from 'zod';

import { logger } from '../src/health.ts';

export const ACTION_ERROR_CODES = [
  'VALIDATION',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL',
] as const;

export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

export type FieldErrors = Record<string, string[]>;

export interface ActionFailure {
  code: ActionErrorCode;
  message: string;
  fieldErrors?: FieldErrors | undefined;
}

export type Result<O> = { ok: true; data: O } | { ok: false; error: ActionFailure };

/** Per-call context. #19 adds the workspace transaction. */
export interface ActionCtx {
  requestId: string;
  /** The caller's session, or `null` when signed out. `requireSession()` throws instead. */
  session: AuthSession | null;
}

export interface SafeActionOptions {
  /** Resolves the session for `ctx.session`. Defaults to `lib/auth.ts` `getSession` (#153). */
  getSession?: () => Promise<AuthSession | null>;
}

async function defaultGetSession(): Promise<AuthSession | null> {
  // Loaded lazily so this module stays free of the database and Next request APIs until used.
  const { getSession } = await import('./auth.ts');
  return getSession();
}

/** `UnauthenticatedError` from `@causedeck/auth`, also matched by its code across module copies. */
function isUnauthenticated(error: unknown): boolean {
  return (
    error instanceof UnauthenticatedError ||
    (error instanceof Error && 'code' in error && error.code === 'UNAUTHENTICATED')
  );
}

/** Throw from a handler to return a specific, client-safe error code. */
export class ActionError extends Error {
  readonly code: ActionErrorCode;
  readonly fieldErrors: FieldErrors | undefined;

  constructor(code: ActionErrorCode, message: string, fieldErrors?: FieldErrors) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

const GENERIC_MESSAGES: Record<ActionErrorCode, string> = {
  VALIDATION: 'Some fields need attention.',
  UNAUTHENTICATED: 'Please sign in again.',
  FORBIDDEN: 'You do not have access to this.',
  NOT_FOUND: 'We could not find this.',
  CONFLICT: 'This changed while you were working. Reload and try again.',
  INTERNAL: 'Something went wrong. Please try again.',
};

/** Issue path -> messages; form-level issues (empty path) go under `_form`. */
function toFieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.length === 0 ? '_form' : issue.path.map(String).join('.');
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function safeAction<I, O>(
  schema: ZodType<I>,
  handler: (input: I, ctx: ActionCtx) => Promise<O>,
  { getSession = defaultGetSession }: SafeActionOptions = {},
): (raw: unknown) => Promise<Result<O>> {
  return async (raw) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: GENERIC_MESSAGES.VALIDATION,
          fieldErrors: toFieldErrors(parsed.error.issues),
        },
      };
    }
    const requestId = randomUUID();
    try {
      const ctx: ActionCtx = { requestId, session: await getSession() };
      return { ok: true, data: await handler(parsed.data, ctx) };
    } catch (error) {
      if (error instanceof ActionError) {
        return {
          ok: false,
          error: {
            code: error.code,
            message: error.message || GENERIC_MESSAGES[error.code],
            ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
          },
        };
      }
      if (isUnauthenticated(error)) {
        return {
          ok: false,
          error: { code: 'UNAUTHENTICATED', message: GENERIC_MESSAGES.UNAUTHENTICATED },
        };
      }
      logger.error({ err: error, requestId }, 'server action failed');
      return { ok: false, error: { code: 'INTERNAL', message: GENERIC_MESSAGES.INTERNAL } };
    }
  };
}
