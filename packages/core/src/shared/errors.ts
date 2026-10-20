// Domain errors shared by every core domain (#177, #293). Codes are a subset of the API error codes
// (`@causedeck/validators/api` API_ERROR_CODES), so the API and server actions map them 1:1. The
// class is defined once here and re-exported from `workspaces/errors.ts`, so `instanceof` holds.
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
