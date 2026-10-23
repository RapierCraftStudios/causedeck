// Domain errors for the workspace service (#177). The shared `WorkspaceError` and its constructors
// live in `shared/errors.ts` (#293) so other domains can throw them without importing workspaces.
import { WorkspaceError, type WorkspaceErrorCode } from '../shared/errors.ts';

export {
  conflict,
  forbidden,
  invalid,
  notFound,
  rateLimited,
  WorkspaceError,
  type WorkspaceErrorCode,
} from '../shared/errors.ts';

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
