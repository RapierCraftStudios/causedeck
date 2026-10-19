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
