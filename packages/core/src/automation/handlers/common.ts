// Helpers shared by the proposal handlers (#47): payload parsing and the graph-row provenance.
import { z } from 'zod';

import { invalid } from '../../shared/errors.ts';
import type { HandlerProvenance } from '../types.ts';

export const uuid = z.uuid();
export const day = z.iso.date();

/** The parsed payload, or VALIDATION with the first issue's path and message. */
export function parsePayload<S extends z.ZodType>(payloadSchema: S, payload: unknown): z.output<S> {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid payload'}`);
  }
  return parsed.data;
}

/** The provenance columns of a graph row written by a handler. */
export function provenanceValues(p: HandlerProvenance) {
  return {
    sourceType: p.sourceType,
    sourceRef: p.sourceRef,
    anchorId: p.anchorId,
    confidence: p.confidence,
    confirmationState: p.confirmationState,
  };
}

/** The Postgres error code under drizzle's wrapper, if any. */
export function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = cause;
  }
  return undefined;
}
