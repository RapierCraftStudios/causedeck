// `email.raw-expire` (#530): deletes the raw MIME of one received email when its 30 days are up
// (`intake_message.raw_expires_at`), unless it is pinned. The extracted text, captures and
// proposals stay. Queued with a delay by `email.intake`; idempotent (a swept message no longer
// matches), so a duplicate run deletes nothing.
import { CAPTURE_JOB_NAMES } from '@causedeck/capture';

import {
  inboundProviderFromProcess,
  sweepExpiredRawMime,
  type InboundEmailProvider,
} from '../../email-intake/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';
import { emailRawExpireSchema, type EmailRawExpireJobPayload } from './email-intake.ts';

/** The job body. Exported for tests. */
export async function runEmailRawExpireJob(
  ctx: Pick<JobContext, 'db' | 'log'>,
  payload: EmailRawExpireJobPayload,
  deps: { provider?: InboundEmailProvider | null; now?: () => Date } = {},
): Promise<{ deleted: number }> {
  const provider = deps.provider === undefined ? inboundProviderFromProcess() : deps.provider;
  const result = await sweepExpiredRawMime(
    { db: ctx.db, provider: provider ?? {}, ...(deps.now === undefined ? {} : { now: deps.now }) },
    payload.workspaceId,
    payload.intakeMessageId,
  );
  ctx.log.info({ deleted: result.deleted }, 'email raw mime expired');
  return result;
}

export const emailRawExpire = defineJob({
  name: CAPTURE_JOB_NAMES.emailRawExpire,
  schema: emailRawExpireSchema,
  singleton: { key: (payload) => `email-raw-expire:${payload.intakeMessageId}` },
  concurrency: 2,
  handler: async (ctx, payload) => {
    await runEmailRawExpireJob(ctx, payload);
  },
});
