// Domain errors for the workspace service (#177). Codes are a subset of the API error codes
// (`@causedeck/validators/api` API_ERROR_CODES), so the API and server actions map them 1:1.
export type WorkspaceErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'VALIDATION';

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
