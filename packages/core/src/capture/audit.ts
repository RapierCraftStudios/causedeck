// Audit writes for the capture domain (#43). Metadata holds ids, the channel, the MIME type and the
// size; never a filename or any file content.
import { record, type AuditAction, type AuditMetadataValue } from '../audit/index.ts';

import type { CaptureCtx } from './context.ts';

export function auditCapture(
  ctx: Pick<CaptureCtx, 'workspaceId' | 'userId' | 'requestId' | 'userAgent' | 'ip'>,
  db: CaptureCtx['db'],
  action: AuditAction,
  target: { kind: 'capture' | 'capture_channel'; id: string },
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

/** Audit write for a job: no user, the system actor. */
export function auditCaptureSystem(
  db: CaptureCtx['db'],
  workspaceId: string,
  action: AuditAction,
  target: { kind: 'capture'; id: string },
  metadata: Record<string, AuditMetadataValue> = {},
): Promise<void> {
  return record(
    { db, workspaceId, actor: { userId: null, kind: 'system' } },
    { action, target, metadata },
  );
}
