// Audit writes for the email-intake domain (#54 part 2), fail-closed in the caller's transaction.
// Metadata holds ids, the domain and the allow-list kind: never an address' local part and never a
// sender address or pattern.
import { record, type AuditAction, type AuditMetadataValue } from '../audit/index.ts';

import type { EmailIntakeCtx } from './context.ts';

export function auditEmailIntake(
  ctx: Pick<EmailIntakeCtx, 'workspaceId' | 'userId' | 'requestId' | 'userAgent' | 'ip'>,
  db: EmailIntakeCtx['db'],
  action: AuditAction,
  target: { kind: 'intake_address' | 'intake_allowlist'; id: string },
  metadata: Record<string, AuditMetadataValue> = {},
): Promise<void> {
  return record(
    {
      db,
      workspaceId: ctx.workspaceId,
      actor: { userId: ctx.userId, kind: 'user' },
      ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
      ...(ctx.userAgent === undefined ? {} : { userAgent: ctx.userAgent }),
      ...(ctx.ip === undefined ? {} : { ip: ctx.ip }),
    },
    { action, target, metadata },
  );
}
