// Server-side gate (#22): `requireFlag` throws `FlagOffError` (`FEATURE_OFF`) when a flag is off.
// Callers map it to a plain 404 (web `notFound()`, api `NOT_FOUND`) so a dark feature is not
// discoverable; the error message never names the flag.
import { isEnabled, type EvaluateDeps, type FlagContext } from './evaluate.ts';
import type { FlagKey } from './keys.ts';

export const FEATURE_OFF = 'FEATURE_OFF' as const;

export class FlagOffError extends Error {
  readonly code = FEATURE_OFF;
  /** Presented as a 404, never as "forbidden". */
  readonly status = 404;

  constructor() {
    super('Not found');
    this.name = 'FlagOffError';
  }
}

export function isFlagOffError(error: unknown): error is FlagOffError {
  return error instanceof FlagOffError;
}

/** Throw `FlagOffError` unless `key` is on for the workspace. */
export async function requireFlag(
  key: FlagKey,
  ctx: FlagContext,
  deps?: EvaluateDeps,
): Promise<void> {
  if (!(await isEnabled(key, ctx, deps))) throw new FlagOffError();
}

export { evaluateAll, isEnabled, type EvaluateDeps, type FlagContext } from './evaluate.ts';
