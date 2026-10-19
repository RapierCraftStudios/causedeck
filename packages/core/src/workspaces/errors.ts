// Domain errors for the workspace service (#177). Codes are a subset of the API error codes
// (`@causedeck/validators/api` API_ERROR_CODES), so the API and server actions map them 1:1.
export type WorkspaceErrorCode =
  'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'VALIDATION' | 'RATE_LIMITED';

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

/** The workspace does not exist, is soft-deleted, or the target member is not in it. */
export function notFound(message = 'Workspace not found'): WorkspaceError {
  return new WorkspaceError('NOT_FOUND', message);
}

export function forbidden(message = 'Only an owner can do this'): WorkspaceError {
  return new WorkspaceError('FORBIDDEN', message);
}

export function conflict(message: string): WorkspaceError {
  return new WorkspaceError('CONFLICT', message);
}

export function invalid(message: string): WorkspaceError {
  return new WorkspaceError('VALIDATION', message);
}

/** Same wording as the auth rate limit, so the limits are indistinguishable. */
export function rateLimited(
  message = 'Too many requests. Please try again later.',
): WorkspaceError {
  return new WorkspaceError('RATE_LIMITED', message);
}

/** Why an invitation token cannot be accepted (#178); the accept UI shows a state per reason. */
export type InvitationErrorReason = 'INVALID' | 'EXPIRED' | 'REVOKED' | 'USED' | 'EMAIL_MISMATCH';

const INVITATION_ERRORS: Record<
  InvitationErrorReason,
  { code: WorkspaceErrorCode; message: string }
> = {
  INVALID: { code: 'NOT_FOUND', message: 'This invitation link is not valid' },
  EXPIRED: { code: 'CONFLICT', message: 'This invitation has expired' },
  REVOKED: { code: 'CONFLICT', message: 'This invitation was revoked' },
  USED: { code: 'CONFLICT', message: 'This invitation has already been used' },
  EMAIL_MISMATCH: {
    code: 'FORBIDDEN',
    message: 'This invitation was sent to a different email address',
  },
};

/** A `WorkspaceError` (same `name`, so action mapping is unchanged) with a typed `reason`. */
export class InvitationError extends WorkspaceError {
  readonly reason: InvitationErrorReason;

  constructor(reason: InvitationErrorReason) {
    const { code, message } = INVITATION_ERRORS[reason];
    super(code, message);
    this.reason = reason;
  }
}

/** True for a Postgres unique violation, raw or wrapped by Drizzle (`DrizzleQueryError.cause`). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    const { code, constraint_name, cause } = current as {
      code?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (code === '23505') return constraint === undefined || constraint_name === constraint;
    current = cause;
  }
  return false;
}
