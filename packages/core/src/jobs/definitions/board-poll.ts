// `system.board.poll` (#493, D-048): reads the Madras HC and Karnataka HC display boards through the
// governed fetch layer, only during court hours (`pollBoards` checks Mon-Fri 10:30-17:00 IST; the
// cron fires every five minutes from 10:00 to 16:55 IST on weekdays and the guard trims the edges)
// and only for halls where a workspace has an item listed today. It has no workspace, so it is
// `system.*` by rule and reads the halls through the owner-defined `app_board_poll_targets` (0074).
// It does nothing while the flag `court.live-tracking` is off or a board source is uncleared. Only
// counts are logged. Core never imports `@causedeck/fetch`: the worker wires the governed fetcher
// through `setBoardFetcherFactory`.
import { z } from 'zod';

import {
  pollBoards,
  type BoardFetcher,
  type PollBoardsDeps,
  type PollBoardsReport,
} from '../../court-day/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';
import { deliveryKey, notificationDeliverSchema } from './notification-deliver.ts';
import { getProducer } from '../producer.ts';

/** Every five minutes, 10:00-16:55 IST, Monday to Friday. */
export const BOARD_POLL_CRON = '*/5 10-16 * * 1-5';

/** Builds the governed fetcher for one poll from the job's db (the worker supplies it at startup). */
export type BoardFetcherFactory = (db: JobContext['db']) => BoardFetcher;

let fetcherFactory: BoardFetcherFactory | null = null;

/** Wiring point: the worker passes a factory over `@causedeck/fetch`; `null` unwires it (tests). */
export function setBoardFetcherFactory(factory: BoardFetcherFactory | null): void {
  fetcherFactory = factory;
}

const unwiredFetcher: BoardFetcher = {
  fetchSource: () =>
    Promise.reject(new Error('board poll: no fetcher wired (setBoardFetcherFactory)')),
};

/**
 * Send one `notification.deliver` job as the registry's `enqueue` does (schema, singleton key,
 * workspace fairness group). The registry imports this file, so it cannot be imported here.
 */
async function enqueueDelivery(job: unknown): Promise<unknown> {
  const data = notificationDeliverSchema.parse(job);
  const sender = await getProducer();
  return sender.send('notification.deliver', data, {
    singletonKey: deliveryKey(data),
    group: { id: data.workspaceId },
  });
}

/** Poll once with the wired governed fetcher (or `deps.fetcher` in tests). */
export async function runBoardPoll(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: Partial<
    Pick<PollBoardsDeps, 'clock' | 'fetcher' | 'flagEnabled' | 'policy' | 'enqueueDelivery'>
  > = {},
): Promise<PollBoardsReport> {
  const report = await pollBoards({
    db: ctx.db,
    fetcher: deps.fetcher ?? fetcherFactory?.(ctx.db) ?? unwiredFetcher,
    enqueueDelivery: deps.enqueueDelivery ?? enqueueDelivery,
    log: (event, counts) => {
      ctx.log.info({ ...counts }, event);
    },
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    ...(deps.flagEnabled === undefined ? {} : { flagEnabled: deps.flagEnabled }),
    ...(deps.policy === undefined ? {} : { policy: deps.policy }),
  });
  ctx.log.info({ ...report }, 'board poll complete');
  return report;
}

export const boardPoll = defineJob({
  name: 'system.board.poll',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  retry: { limit: 1 },
  singleton: { key: () => 'board-poll', policy: 'stately' },
  schedule: { cron: BOARD_POLL_CRON, payload: {} },
  handler: async (ctx) => {
    await runBoardPoll(ctx);
  },
});
