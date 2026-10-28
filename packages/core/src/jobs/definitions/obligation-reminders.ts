// `obligation.reminders` (#67): daily 07:00 IST. `system.obligation.reminders` lists the live
// workspaces (ids and timezone only, through the owner-defined `app_notification_digest_targets`)
// and enqueues `obligation.reminders` for each; that job notifies each member once for the local
// day (`sendObligationReminders`: counts and a link, in-app through #23). A rerun sends nothing.
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { sendObligationReminders } from '../../obligations/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { getProducer } from '../producer.ts';

import { workspaceTimezone } from './notification-deliver.ts';

export const obligationRemindersSchema = z.object({ workspaceId: workspaceIdSchema });
export type ObligationRemindersPayload = z.output<typeof obligationRemindersSchema>;

const key = (p: ObligationRemindersPayload) => `obligation-reminders:${p.workspaceId}`;

export interface ObligationReminderScheduleDeps {
  enqueue?: (payload: ObligationRemindersPayload) => Promise<unknown>;
}

async function enqueueWorkspace(payload: ObligationRemindersPayload): Promise<unknown> {
  const data = obligationRemindersSchema.parse(payload);
  const sender = await getProducer();
  return sender.send('obligation.reminders', data, {
    singletonKey: key(data),
    group: { id: data.workspaceId },
  });
}

export async function runObligationReminderSchedule(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: ObligationReminderScheduleDeps = {},
): Promise<number> {
  const send = deps.enqueue ?? enqueueWorkspace;
  const rows = await ctx.db.execute<{ workspace_id: string }>(
    sql`select workspace_id::text from app_notification_digest_targets()`,
  );
  for (const row of rows) await send({ workspaceId: row.workspace_id });
  ctx.log.info({ workspaces: rows.length }, 'obligation reminders scheduled');
  return rows.length;
}

export const obligationRemindersSchedule = defineJob({
  name: 'system.obligation.reminders',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'obligation-reminders', policy: 'stately' },
  // Daily 07:00 in Asia/Kolkata.
  schedule: { cron: '0 7 * * *', payload: {} },
  handler: async (ctx) => {
    await runObligationReminderSchedule(ctx);
  },
});

export const obligationReminders = defineJob({
  name: 'obligation.reminders',
  schema: obligationRemindersSchema,
  concurrency: 2,
  retry: { limit: 3, delaySec: 60, backoff: true, delayMaxSec: 1800 },
  singleton: { key },
  handler: async (ctx, payload) => {
    const timeZone = await workspaceTimezone(ctx, payload.workspaceId);
    const summary = await sendObligationReminders({ db: ctx.db, timeZone }, payload.workspaceId);
    ctx.log.info({ workspaceId: payload.workspaceId, ...summary }, 'obligation reminders done');
  },
});
