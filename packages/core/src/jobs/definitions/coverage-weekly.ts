// `system.coverage.weekly` (#517, D-049): every Monday morning (IST) email enabled ops and admin
// staff the data coverage report: the biggest gaps by live demand and the level changes since last
// week. The job has no workspace, so `once()` does not apply; the singleton key and the weekly
// schedule give one send per week, and the subject carries the week. Nothing is sent when there is
// no recipient. Counts, ids and levels only.
import { schema } from '@causedeck/db';
import type { EmailTransport } from '@causedeck/notifications/email';
import { and, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  coverageReport,
  readCatalogueCoverageInputs,
  type CoverageChange,
  type CoverageGap,
  type CoverageInputs,
} from '../../sources/coverage.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

import { businessIstDay } from './business-cost-alert.ts';
import { notificationJobDeps } from './notification-deliver.ts';

const { staffUser, user } = schema;

const TOP_GAPS = 20;

export interface CoverageWeeklyDeps {
  now?: () => Date;
  inputs?: () => Promise<CoverageInputs>;
  email?: EmailTransport;
  recipients?: readonly string[];
}

export interface CoverageWeeklyReport {
  sent: number;
  gaps: number;
  changes: number;
}

/** The subject, text and HTML of the weekly report. Exported for tests. */
export function renderCoverageReport(
  gaps: readonly CoverageGap[],
  changes: readonly CoverageChange[],
  covered: { forums: number; cells: number; live: number },
  weekOf: string,
): { subject: string; text: string; html: string } {
  const rows = [
    `Forums ${String(covered.forums)}; cells with a level ${String(covered.live)} of ${String(covered.cells)}.`,
    `Level changes since last week: ${String(changes.length)}`,
    ...changes.map((c) => `${c.forumCode} ${c.dataType}: ${c.from} to ${c.to}`),
    `Top gaps by demand:`,
    ...gaps
      .slice(0, TOP_GAPS)
      .map(
        (g) =>
          `${g.forumCode} ${g.dataType} (${g.level}): ${String(g.watches)} watches, ${String(g.users)} users, score ${String(g.score)}`,
      ),
  ];
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    subject: `CauseDeck coverage report, week of ${weekOf}`,
    text: rows.join('\n'),
    html: rows.map((r) => `<p>${esc(r)}</p>`).join(''),
  };
}

/** Emails of enabled ops and admin staff. */
async function staffRecipients(db: JobContext['db']): Promise<string[]> {
  const rows = await db
    .select({ email: user.email })
    .from(staffUser)
    .innerJoin(user, sql`${user.id} = ${staffUser.userId}`)
    .where(and(isNull(staffUser.disabledAt), inArray(staffUser.role, ['ops', 'admin'])));
  return rows.map((r) => r.email);
}

/** Build and email the report. Exported for tests. */
export async function runCoverageWeekly(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: CoverageWeeklyDeps = {},
): Promise<CoverageWeeklyReport> {
  const now = deps.now?.() ?? new Date();
  const recipients = deps.recipients ?? (await staffRecipients(ctx.db));
  if (recipients.length === 0) {
    ctx.log.info('coverage weekly: no staff recipients');
    return { sent: 0, gaps: 0, changes: 0 };
  }
  const inputs = await (deps.inputs?.() ?? readCatalogueCoverageInputs(ctx.db, now));
  const { coverage, gaps, changes } = coverageReport(inputs, now);
  const cells = coverage.flatMap((r) => Object.values(r.cells));
  const message = renderCoverageReport(
    gaps,
    changes,
    {
      forums: coverage.length,
      cells: cells.length,
      live: cells.filter((c) => c.level !== 'none').length,
    },
    businessIstDay(now),
  );
  const email = deps.email ?? notificationJobDeps(ctx.log).email;
  for (const to of recipients) {
    await email.send({ to, ...message, tags: { template: 'coverage.weekly' } });
  }
  ctx.log.info(
    { sent: recipients.length, gaps: gaps.length, changes: changes.length },
    'coverage weekly sent',
  );
  return { sent: recipients.length, gaps: gaps.length, changes: changes.length };
}

export const coverageWeekly = defineJob({
  name: 'system.coverage.weekly',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'coverage-weekly', policy: 'stately' },
  // Mondays at 09:30 IST.
  schedule: { cron: '30 9 * * 1', payload: {} },
  handler: async (ctx) => {
    await runCoverageWeekly(ctx);
  },
});
