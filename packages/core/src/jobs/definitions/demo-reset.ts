// `system.demo.reset` (#93): nightly at 03:10 IST, restores every demo workspace that exists to the seed
// version (`DEMO_VERSION`), removes the visitors of the last day and writes a `demo.reset` audit
// event per workspace. Rows a visitor added are removed with the seed's own, so tomorrow's demo
// starts clean and its "today" lists are today's. It has no workspace of its own: the demo
// workspaces are found through the owner-defined `app_demo_workspaces()`, and a deployment with no
// demo workspace does nothing. Idempotent.
import { z } from 'zod';

import { resetDemo, sweepExpiredDemoVisitors, type DemoResetSummary } from '../../demo/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

export interface DemoResetReport {
  workspaces: DemoResetSummary[];
  visitorsSwept: number;
}

/** Reset every demo workspace. Exported for tests. */
export async function runDemoReset(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: { now?: () => Date; today?: string } = {},
): Promise<DemoResetReport> {
  const workspaces = await resetDemo(
    { db: ctx.db, ...(deps.now ? { now: deps.now } : {}) },
    deps.today === undefined ? {} : { today: deps.today },
  );
  const visitorsSwept = await sweepExpiredDemoVisitors({
    db: ctx.db,
    ...(deps.now ? { now: deps.now } : {}),
  });
  ctx.log.info(
    { workspaces: workspaces.length, ms: workspaces.map((w) => w.ms), visitorsSwept },
    'demo reset',
  );
  return { workspaces, visitorsSwept };
}

export const demoReset = defineJob({
  name: 'system.demo.reset',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'demo-reset', policy: 'stately' },
  schedule: { cron: '10 3 * * *', payload: {} },
  handler: async (ctx) => {
    await runDemoReset(ctx);
  },
});
