// The problem+json model: stable codes, RFC 9457 shape, no leaks for unexpected errors.
import { UnauthenticatedError as SessionUnauthenticatedError } from '@causedeck/auth';
import { closeTestDb } from '@causedeck/db/testing';
import { API_ERROR_CODES } from '@causedeck/validators/api';
import { afterAll, describe, expect, it } from 'vitest';

import {
  ApiError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  RateLimitedError,
  toProblem,
  UnauthenticatedError,
  ValidationError,
} from '../errors.ts';
import type { AppRouter } from '../lib/openapi.ts';
import { toApiError } from '../middleware/error-handler.ts';

import { call, makeApp, memoryLogger, problemOf } from './helpers.ts';

afterAll(closeTestDb);

describe('error codes', () => {
  it('are the stable set shared with safeAction plus RATE_LIMITED and PAYLOAD_TOO_LARGE', () => {
    expect(API_ERROR_CODES).toEqual([
      'VALIDATION',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'PAYLOAD_TOO_LARGE',
      'RATE_LIMITED',
      'INTERNAL',
    ]);
  });

  it.each([
    [new ValidationError([{ path: 'body.x', message: 'Required' }]), 422, 'VALIDATION'],
    [new UnauthenticatedError(), 401, 'UNAUTHENTICATED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new ConflictError(), 409, 'CONFLICT'],
    [new RateLimitedError(30), 429, 'RATE_LIMITED'],
    [new InternalError(), 500, 'INTERNAL'],
  ] as const)('%s maps to %i %s', (error, status, code) => {
    const problem = toProblem(error, 'req-1');
    expect(problem).toMatchObject({ status, code, requestId: 'req-1' });
    expect(problem.type).toBe(`urn:causedeck:problem:${code.toLowerCase().replaceAll('_', '-')}`);
    expect(problem.title).toEqual(expect.any(String));
  });

  it('maps the auth package UnauthenticatedError to UNAUTHENTICATED', () => {
    expect(toApiError(new SessionUnauthenticatedError())?.code).toBe('UNAUTHENTICATED');
    expect(toApiError(new Error('x'))).toBeNull();
    expect(toApiError(new ApiError(409, 'CONFLICT'))?.status).toBe(409);
  });
});

describe('unexpected errors', () => {
  it('become a 500 INTERNAL problem with requestId and no message or stack', async () => {
    const { logger, lines } = memoryLogger();
    const routes = (v1: AppRouter) => {
      v1.get('/explode', () => {
        throw new Error('db password is hunter2 at /srv/app/secret.ts:42');
      });
    };
    // Public on purpose: a plain Hono route, so no auth is needed to reach the throw.
    const app = makeApp({ routes, logger });
    const response = await call(app, '/v1/explode');
    expect(response.status).toBe(500);
    const text = await response.clone().text();
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('secret.ts');
    expect(text).not.toContain('at ');
    const problem = await problemOf(response);
    expect(problem).toMatchObject({ code: 'INTERNAL', status: 500 });
    expect(problem.requestId).toBe(response.headers.get('x-request-id'));
    expect(
      lines.some((l) => l.msg === 'unhandled API error' && l.requestId === problem.requestId),
    ).toBe(true);
  });
});
