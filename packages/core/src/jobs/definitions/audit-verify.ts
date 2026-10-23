// Nightly audit chain verification (#230, #26 part 5). Two jobs:
// - `system.audit.verify` runs daily at 02:00 IST. It verifies the account chain (account-level
//   events, `workspace_id` null) and enqueues `audit.verify` for every workspace with a chain. It
//   has no workspace and `audit_event` is under FORCE RLS, so it reads through the owner-defined
//   `app_audit_verify_account_chain` and `app_audit_chain_targets` functions (0019_audit_jobs).
// - `audit.verify` runs `verifyChain` for one workspace inside its `withWorkspace` transaction.
// Both start at the oldest surviving row (`from` the epoch): retention deletes a chain's oldest
// events, leaving the first survivor's `prev_hash` pointing at a deleted row. Every surviving
// row's hash is still checked. A mismatch is logged as a critical `audit.chain_mismatch` (ids and
// the reason only) and the job completes: retrying would only repeat the alert.
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { verifyChain, type ChainVerification } from '../../audit/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { getProducer } from '../producer.ts';

/** Verification starts here, so a purged chain starts at its oldest surviving row. */
const VERIFY_FROM = new Date(0);

export const CHAIN_MISMATCH_EVENT = 'audit.chain_mismatch';

function report(
  ctx: Pick<JobContext, 'log'>,
  workspaceId: string | null,
  result: ChainVerification,
): ChainVerification {
  if (result.ok) {
    ctx.log.info({ workspaceId, checked: result.checked }, 'audit chain verified');
  } else {
    ctx.log.fatal(
      {
        event: CHAIN_MISMATCH_EVENT,
        severity: 'critical',
        workspaceId,
        eventId: result.brokenAt?.id,
        reason: result.brokenAt?.reason,
        checked: result.checked,
      },
      CHAIN_MISMATCH_EVENT,
    );
  }
  return result;
}

/** Verify one workspace's chain and log the outcome. Exported for tests. */
export async function runAuditVerify(
  ctx: Pick<JobContext, 'db' | 'log'>,
  workspaceId: string,
): Promise<ChainVerification> {
  return report(ctx, workspaceId, await verifyChain(ctx.db, workspaceId, { from: VERIFY_FROM }));
}

/** Verify the account chain and log the outcome. Exported for tests. */
export async function runAccountChainVerify(
  ctx: Pick<JobContext, 'db' | 'log'>,
): Promise<ChainVerification> {
  const from = VERIFY_FROM.toISOString();
  const [row] = await ctx.db.execute<{
    checked: number;
    id: string | null;
    reason: 'hash' | 'link' | 'actor' | null;
  }>(
    sql`select checked, id::text, reason
        from app_audit_verify_account_chain(${from}::timestamptz, null)`,
  );
  const checked = row?.checked ?? 0;
  const result: ChainVerification =
    row?.id && row.reason
      ? { ok: false, checked, brokenAt: { id: row.id, reason: row.reason } }
      : { ok: true, checked };
  return report(ctx, null, result);
}

const auditVerifySchema = z.object({ workspaceId: workspaceIdSchema });

export interface AuditVerifyScheduleDeps {
  enqueue?: (workspaceId: string) => Promise<unknown>;
}

/**
 * Send one `audit.verify` job as the registry's `enqueue` does (schema, singleton key, workspace
 * fairness group). The registry imports this file, so it cannot be imported here.
 */
async function enqueueAuditVerify(workspaceId: string): Promise<unknown> {
  const data = auditVerifySchema.parse({ workspaceId });
  const sender = await getProducer();
  return sender.send('audit.verify', data, {
    singletonKey: `audit-verify:${data.workspaceId}`,
    group: { id: data.workspaceId },
  });
}

/** Verify the account chain, then enqueue `audit.verify` per workspace. Exported for tests. */
export async function runAuditVerifySchedule(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: AuditVerifyScheduleDeps = {},
): Promise<string[]> {
  await runAccountChainVerify(ctx);
  const send = deps.enqueue ?? enqueueAuditVerify;
  const rows = await ctx.db.execute<{ workspace_id: string }>(
    sql`select workspace_id::text from app_audit_chain_targets()`,
  );
  const workspaces = rows.map((row) => row.workspace_id);
  for (const workspaceId of workspaces) await send(workspaceId);
  ctx.log.info({ enqueued: workspaces.length }, 'audit chain verification scheduled');
  return workspaces;
}

export const systemAuditVerify = defineJob({
  name: 'system.audit.verify',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'audit-verify', policy: 'stately' },
  schedule: { cron: '0 2 * * *', payload: {} },
  handler: async (ctx) => {
    await runAuditVerifySchedule(ctx);
  },
});

export const auditVerify = defineJob({
  name: 'audit.verify',
  schema: auditVerifySchema,
  concurrency: 2,
  singleton: { key: (payload) => `audit-verify:${payload.workspaceId}` },
  handler: async (ctx, { workspaceId }) => {
    await runAuditVerify(ctx, workspaceId);
  },
});
