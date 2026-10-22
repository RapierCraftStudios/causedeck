// Throwing and filtering helpers over `can()` (#231).
import type { AuthLogger } from '../mailer';
import type { Action } from './actions';
import { can, type Actor, type DenyReason, type PolicySettings, type Resource } from './can';
import { consoleDenialLogger, logDenial } from './log';

/** The actor may not take the action. Callers map `code` to their `FORBIDDEN` response. */
export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN' as const;
  readonly reason: DenyReason;
  readonly action: Action;

  constructor(action: Action, reason: DenyReason) {
    super(`Forbidden: ${action} (${reason})`);
    this.name = 'ForbiddenError';
    this.action = action;
    this.reason = reason;
  }
}

/** `ForbiddenError`, also matched by name and code across module copies. */
export function isForbiddenError(error: unknown): error is ForbiddenError {
  return (
    error instanceof ForbiddenError ||
    (error instanceof Error &&
      error.name === 'ForbiddenError' &&
      'code' in error &&
      error.code === 'FORBIDDEN' &&
      'reason' in error &&
      'action' in error)
  );
}

/** Resource-level reasons: the resource exists but is not the actor's to see. */
const CONCEALED_REASONS: ReadonlySet<DenyReason> = new Set<DenyReason>([
  'CROSS_WORKSPACE',
  'RESTRICTED_MATTER',
  'NOT_ASSIGNED',
]);

/**
 * True when a denial must look like `NOT_FOUND` rather than `FORBIDDEN`: a read of a resource the
 * actor may not see, so its existence does not leak.
 */
export function conceals(error: Pick<ForbiddenError, 'action' | 'reason'>): boolean {
  return error.action.endsWith('.read') && CONCEALED_REASONS.has(error.reason);
}

export interface AssertOptions {
  settings?: PolicySettings;
  /** Receives the denial log line; defaults to the console. */
  logger?: Pick<AuthLogger, 'warn'>;
}

export function assertCan(
  actor: Actor,
  action: Action,
  resource?: Resource,
  options: AssertOptions = {},
): void {
  const decision = can(actor, action, resource, options.settings);
  if (decision.allow) return;
  logDenial(options.logger ?? consoleDenialLogger, actor, action, decision.reason);
  throw new ForbiddenError(action, decision.reason);
}

/** The items `actor` may take `action` on (default `matter.read`), in order. */
export function filterVisible<T extends Resource>(
  items: readonly T[],
  actor: Actor,
  settings?: PolicySettings,
  action: Action = 'matter.read',
): T[] {
  return items.filter((item) => can(actor, action, item, settings).allow);
}
