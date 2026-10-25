// `email.intake` (#530): reads one received forwarded email, applies sender trust, runs the parser
// registry and stores its captures and proposals. The inbound webhook queues it (ids only) in the
// same transaction that records the message. The body is `runEmailIntake` in the email-intake
// domain. Singleton and idempotent per message; five attempts with exponential backoff, then the
// dead-letter queue (`pnpm worker dlq`, the admin job metrics). Once a message is worked, a delayed
// `email.raw-expire` job deletes its raw MIME when the 30 days are up.
import {
  CAPTURE_JOB_NAMES,
  CAPTURE_JOB_RETRIES,
  CAPTURE_JOB_RETRY_DELAY_SEC,
} from '@causedeck/capture';
import { serverEnv } from '@causedeck/config/env';
import { createObjectStoreFromEnv, type ObjectStore } from '@causedeck/storage';
import { z } from 'zod';

import { captureConfigFromProcess, type CaptureJobs } from '../../capture/index.ts';
import {
  inboundProviderFromProcess,
  runEmailIntake,
  type EmailIntakeOutcome,
  type InboundEmailProvider,
} from '../../email-intake/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { getProducer } from '../producer.ts';
import { enqueueCaptureProcess } from './capture-process.ts';
import { enqueueCaptureScan } from './capture-scan.ts';

export const emailIntakeSchema = z.object({
  workspaceId: workspaceIdSchema,
  userId: z.uuid(),
  intakeMessageId: z.uuid(),
});

export type EmailIntakeJobPayload = z.output<typeof emailIntakeSchema>;

export const emailRawExpireSchema = z.object({
  workspaceId: workspaceIdSchema,
  intakeMessageId: z.uuid(),
});

export type EmailRawExpireJobPayload = z.output<typeof emailRawExpireSchema>;

let defaultStore: ObjectStore | undefined;

/** Send one `email.intake` job as the registry's `enqueue` does. */
export async function enqueueEmailIntake(payload: EmailIntakeJobPayload): Promise<unknown> {
  const data = emailIntakeSchema.parse(payload);
  const sender = await getProducer();
  return sender.send(CAPTURE_JOB_NAMES.emailIntake, data, {
    singletonKey: `email-intake:${data.intakeMessageId}`,
    group: { id: data.workspaceId },
  });
}

/** Queue the raw-MIME deletion for when the message's retention ends. */
async function scheduleRawExpire(payload: EmailRawExpireJobPayload, at: Date): Promise<unknown> {
  const data = emailRawExpireSchema.parse(payload);
  const sender = await getProducer();
  return sender.send(CAPTURE_JOB_NAMES.emailRawExpire, data, {
    singletonKey: `email-raw-expire:${data.intakeMessageId}`,
    startAfter: at,
    group: { id: data.workspaceId },
  });
}

/** The job body. Exported for tests. */
export async function runEmailIntakeJob(
  ctx: Pick<JobContext, 'db' | 'log' | 'attempt'>,
  payload: EmailIntakeJobPayload,
  deps: {
    provider?: InboundEmailProvider | null;
    store?: ObjectStore;
    jobs?: CaptureJobs;
    scheduleExpire?: (payload: EmailRawExpireJobPayload, at: Date) => Promise<unknown>;
    now?: () => Date;
  } = {},
): Promise<EmailIntakeOutcome> {
  const provider = deps.provider === undefined ? inboundProviderFromProcess() : deps.provider;
  if (provider === null) throw new Error('no inbound email provider is configured');
  const outcome = await runEmailIntake(
    {
      db: ctx.db,
      store: deps.store ?? (defaultStore ??= createObjectStoreFromEnv(serverEnv())),
      provider,
      config: captureConfigFromProcess(),
      jobs: deps.jobs ?? { scan: enqueueCaptureScan, process: enqueueCaptureProcess },
      ...(deps.now === undefined ? {} : { now: deps.now }),
    },
    payload,
  );
  ctx.log.info(
    {
      intakeMessageId: payload.intakeMessageId,
      outcome: outcome.outcome,
      ...(outcome.outcome === 'processed'
        ? { parserId: outcome.parserId, captures: outcome.captures, proposals: outcome.proposals }
        : {}),
      ...(outcome.outcome === 'dropped' || outcome.outcome === 'quarantined'
        ? { reason: outcome.reason }
        : {}),
    },
    'email intake',
  );
  if (
    outcome.outcome === 'processed' ||
    outcome.outcome === 'dropped' ||
    outcome.outcome === 'quarantined'
  ) {
    await (deps.scheduleExpire ?? scheduleRawExpire)(
      { workspaceId: payload.workspaceId, intakeMessageId: payload.intakeMessageId },
      outcome.rawExpiresAt,
    );
  }
  return outcome;
}

export const emailIntake = defineJob({
  name: CAPTURE_JOB_NAMES.emailIntake,
  schema: emailIntakeSchema,
  singleton: { key: (payload) => `email-intake:${payload.intakeMessageId}` },
  idempotencyKey: (payload) => `email-intake:${payload.intakeMessageId}`,
  concurrency: 2,
  retry: { limit: CAPTURE_JOB_RETRIES, delaySec: CAPTURE_JOB_RETRY_DELAY_SEC, backoff: true },
  handler: async (ctx, payload) => {
    await runEmailIntakeJob(ctx, payload);
  },
});
