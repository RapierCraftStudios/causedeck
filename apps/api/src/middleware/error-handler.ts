// `onError` / `notFound`: every failure leaves as problem+json. Unknown errors are logged with the
// request id and become a generic `INTERNAL`; their message and stack never reach the client.
import { UnauthenticatedError as SessionUnauthenticatedError } from '@causedeck/auth';
import { InvalidCursorError } from '@causedeck/core/workspaces';
import { isFlagOffError } from '@causedeck/flags/server';
import type { Logger } from '@causedeck/observability';
import { requestIdFrom } from '@causedeck/observability';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

import {
  ApiError,
  InternalError,
  NotFoundError,
  problemResponse,
  UnauthenticatedError,
  ValidationError,
} from '../errors.ts';
import type { AppEnv, AppVariables } from '../lib/openapi.ts';

function requestIdOf(c: Context<AppEnv>): string {
  // Unset when the failure happened before the request-id middleware ran.
  const vars: Partial<AppVariables> = c.var;
  return vars.requestId ?? requestIdFrom(c.req.raw.headers);
}

/** Map anything thrown to an `ApiError`; `null` means unexpected. */
export function toApiError(error: unknown): ApiError | null {
  if (error instanceof ApiError) return error;
  if (error instanceof SessionUnauthenticatedError) return new UnauthenticatedError();
  // A disabled feature (`requireFlag` in a handler) is indistinguishable from a missing route (#22).
  if (isFlagOffError(error)) return new NotFoundError();
  if (error instanceof InvalidCursorError) {
    return new ValidationError([{ path: 'query.cursor', message: 'Invalid cursor' }]);
  }
  // Hono's own validators throw 400 for unparseable bodies (e.g. malformed JSON).
  if (error instanceof HTTPException && error.status === 400) {
    return new ValidationError([{ path: 'body', message: 'Malformed request body' }]);
  }
  return null;
}

export function errorHandler(logger: Logger): ErrorHandler<AppEnv> {
  return (error, c) => {
    const requestId = requestIdOf(c);
    const mapped = toApiError(error);
    if (mapped === null) {
      logger.error({ err: error, requestId }, 'unhandled API error');
      return problemResponse(new InternalError(), requestId);
    }
    return problemResponse(mapped, requestId);
  };
}

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  problemResponse(new NotFoundError(), requestIdOf(c));
