// API error model (#14): RFC 9457 problem+json with a stable `code`. The codes are a superset of
// the web `safeAction` codes (apps/web/lib/safe-action.ts) plus `RATE_LIMITED`.
import { z } from 'zod';

export const API_ERROR_CODES = [
  'VALIDATION',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export const FieldErrorSchema = z.object({
  /** Dotted path into the request part, e.g. `body.items.0.name` or `query.limit`. */
  path: z.string(),
  message: z.string(),
});

export type FieldError = z.infer<typeof FieldErrorSchema>;

export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    code: z.enum(API_ERROR_CODES),
    requestId: z.string(),
    errors: z.array(FieldErrorSchema).optional(),
  })
  .meta({ id: 'Problem' });

export type Problem = z.infer<typeof ProblemSchema>;
