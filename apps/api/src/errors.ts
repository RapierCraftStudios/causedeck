// RFC 9457 problem details for every API error (#14). Handlers throw `ApiError`s; the error
// handler turns anything else into `INTERNAL` without leaking messages or stacks.
import {
  PROBLEM_CONTENT_TYPE,
  type ApiErrorCode,
  type FieldError,
  type Problem,
} from '@causedeck/validators/api';

const TITLES: Record<ApiErrorCode, string> = {
  VALIDATION: 'Validation failed',
  UNAUTHENTICATED: 'Not signed in',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not found',
  CONFLICT: 'Conflict',
  PAYLOAD_TOO_LARGE: 'Payload too large',
  RATE_LIMITED: 'Too many requests',
  INTERNAL: 'Internal error',
};

/** `type` URI for a code, documented in docs/engineering/api.md. */
export function problemType(code: ApiErrorCode): string {
  return `urn:causedeck:problem:${code.toLowerCase().replaceAll('_', '-')}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly errors: FieldError[] | undefined;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: ApiErrorCode,
    detail?: string,
    options: { errors?: FieldError[]; headers?: Record<string, string> } = {},
  ) {
    super(detail ?? TITLES[code]);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.errors = options.errors;
    this.headers = options.headers ?? {};
  }
}

export class ValidationError extends ApiError {
  constructor(errors: FieldError[], detail = 'The request is invalid.') {
    super(422, 'VALIDATION', detail, { errors });
    this.name = 'ValidationError';
  }
}

export class UnauthenticatedError extends ApiError {
  constructor(detail = 'Authentication is required.') {
    super(401, 'UNAUTHENTICATED', detail);
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(detail = 'You do not have access to this resource.') {
    super(403, 'FORBIDDEN', detail);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends ApiError {
  constructor(detail = 'The resource does not exist.') {
    super(404, 'NOT_FOUND', detail);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ApiError {
  constructor(detail = 'The request conflicts with the current state.') {
    super(409, 'CONFLICT', detail);
    this.name = 'ConflictError';
  }
}

export class PayloadTooLargeError extends ApiError {
  constructor(maxBytes: number) {
    super(413, 'PAYLOAD_TOO_LARGE', `The request body exceeds ${String(maxBytes)} bytes.`);
    this.name = 'PayloadTooLargeError';
  }
}

export class RateLimitedError extends ApiError {
  constructor(retryAfterSeconds: number, headers: Record<string, string> = {}) {
    super(429, 'RATE_LIMITED', 'Rate limit exceeded; retry later.', {
      headers: { ...headers, 'retry-after': String(retryAfterSeconds) },
    });
    this.name = 'RateLimitedError';
  }
}

export class InternalError extends ApiError {
  constructor() {
    super(500, 'INTERNAL', 'An unexpected error occurred.');
    this.name = 'InternalError';
  }
}

export function toProblem(error: ApiError, requestId: string): Problem {
  return {
    type: problemType(error.code),
    title: TITLES[error.code],
    status: error.status,
    detail: error.message,
    code: error.code,
    requestId,
    ...(error.errors !== undefined && { errors: error.errors }),
  };
}

export function problemResponse(error: ApiError, requestId: string): Response {
  return new Response(JSON.stringify(toProblem(error, requestId)), {
    status: error.status,
    headers: { ...error.headers, 'content-type': PROBLEM_CONTENT_TYPE },
  });
}

interface ZodLikeIssue {
  path: readonly PropertyKey[];
  message: string;
}

/** Field-level errors from zod issues, prefixed with the request part (`body`, `query`, ...). */
export function fieldErrors(target: string, issues: readonly ZodLikeIssue[]): FieldError[] {
  return issues.map((issue) => ({
    path: [target, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}
