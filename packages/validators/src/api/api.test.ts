import { describe, expect, it } from 'vitest';

import {
  API_ERROR_CODES,
  MAX_PAGE_LIMIT,
  MeResponseSchema,
  ProblemSchema,
  WorkspaceListQuerySchema,
} from './index';

describe('@causedeck/validators/api', () => {
  it('keeps the safeAction codes and adds RATE_LIMITED', () => {
    for (const code of [
      'VALIDATION',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'INTERNAL',
    ]) {
      expect(API_ERROR_CODES).toContain(code);
    }
    expect(API_ERROR_CODES).toContain('RATE_LIMITED');
  });

  it('parses a problem body', () => {
    const problem = {
      type: 'urn:causedeck:problem:validation',
      title: 'Validation failed',
      status: 422,
      code: 'VALIDATION',
      requestId: 'r1',
      errors: [{ path: 'query.limit', message: 'Too small' }],
    };
    expect(ProblemSchema.parse(problem)).toEqual(problem);
    expect(ProblemSchema.safeParse({ ...problem, code: 'NOPE' }).success).toBe(false);
  });

  it('coerces and bounds pagination', () => {
    expect(WorkspaceListQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(WorkspaceListQuerySchema.parse({ limit: '10', cursor: 'abc' })).toEqual({
      limit: 10,
      cursor: 'abc',
    });
    expect(WorkspaceListQuerySchema.safeParse({ limit: String(MAX_PAGE_LIMIT + 1) }).success).toBe(
      false,
    );
    expect(WorkspaceListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('names shared schemas for OpenAPI components', () => {
    expect(MeResponseSchema.meta()?.id).toBe('Me');
    expect(ProblemSchema.meta()?.id).toBe('Problem');
  });
});
