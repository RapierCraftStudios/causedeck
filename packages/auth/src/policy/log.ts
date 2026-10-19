// The structured denial log line (#231): action, role and reason only, never resource content.
import type { AuthLogger } from '../mailer';
import type { Action } from './actions';
import type { Actor, DenyReason } from './can';

/** Used when no logger is injected; mirrors `consoleLogger` without pulling in the mailer. */
export const consoleDenialLogger: Pick<AuthLogger, 'warn'> = {
  warn: (obj, msg) => {
    console.warn(msg ?? '', obj);
  },
};

export function logDenial(
  logger: Pick<AuthLogger, 'warn'>,
  actor: Actor,
  action: Action,
  reason: DenyReason,
): void {
  logger.warn(
    { event: 'authz.denied', action, role: actor.role, reason, workspaceId: actor.workspaceId },
    'authorization denied',
  );
}
