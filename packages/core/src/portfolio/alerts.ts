// Portfolio exception alerts (#665, part 5 of #498, D-048 B2B): for one institution workspace, find
// the cases with a new adverse order (recorded in the last 7 days) or a missed next date (before
// today in IST, within the last 30 days) and notify every active member (`portfolio.adverse_order`,
// `portfolio.missed_date`). Idempotent: the dedupe key names the case and the order or date, so a
// re-run notifies nobody twice. Reads the case columns only; it never fetches. A failed notice does
// not stop the others.
import { isUuid, schema, withWorkspace, type Queryable } from '@causedeck/db';
import { notify, type DeliveryJob } from '@causedeck/notifications';
import { and, asc, eq, gte, isNotNull, lt } from 'drizzle-orm';

const { member, portfolioCase } = schema;

/** Cases of each kind alerted per workspace and run; the rest wait for the next run. */
export const PORTFOLIO_ALERT_MAX_CASES = 500;
const ADVERSE_LOOKBACK_DAYS = 7;
const MISSED_LOOKBACK_DAYS = 30;
const IST_OFFSET_MS = 330 * 60_000;

export interface PortfolioAlertDeps {
  db: Queryable;
  /** `NotifyContext.enqueueDelivery`: sends one `notification.deliver` job. */
  enqueueDelivery: (job: DeliveryJob) => Promise<unknown>;
  now?: () => Date;
}

export interface PortfolioAlertReport {
  adverse: number;
  missed: number;
  notified: number;
}

const istDay = (at: Date) => new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Scan one workspace and notify its active members of each new exception. */
export async function scanPortfolioAlerts(
  deps: PortfolioAlertDeps,
  workspaceId: string,
): Promise<PortfolioAlertReport> {
  const report: PortfolioAlertReport = { adverse: 0, missed: 0, notified: 0 };
  if (!isUuid(workspaceId)) return report;
  const now = deps.now?.() ?? new Date();
  const today = istDay(now);
  const missedFrom = istDay(new Date(now.getTime() - MISSED_LOOKBACK_DAYS * 86_400_000));
  const adverseFrom = new Date(now.getTime() - ADVERSE_LOOKBACK_DAYS * 86_400_000);

  const found = await withWorkspace(deps.db, { workspaceId }, async (tx) => {
    const columns = {
      id: portfolioCase.id,
      cnr: portfolioCase.cnr,
      caseNumber: portfolioCase.caseNumber,
      nextDate: portfolioCase.nextDate,
      adverseAt: portfolioCase.lastAdverseOrderAt,
      adverseRef: portfolioCase.lastAdverseOrderRef,
    };
    const adverse = await tx
      .select(columns)
      .from(portfolioCase)
      .where(
        and(
          eq(portfolioCase.workspaceId, workspaceId),
          isNotNull(portfolioCase.lastAdverseOrderAt),
          gte(portfolioCase.lastAdverseOrderAt, adverseFrom),
        ),
      )
      .orderBy(asc(portfolioCase.id))
      .limit(PORTFOLIO_ALERT_MAX_CASES);
    const missed = await tx
      .select(columns)
      .from(portfolioCase)
      .where(
        and(
          eq(portfolioCase.workspaceId, workspaceId),
          isNotNull(portfolioCase.nextDate),
          lt(portfolioCase.nextDate, today),
          gte(portfolioCase.nextDate, missedFrom),
        ),
      )
      .orderBy(asc(portfolioCase.id))
      .limit(PORTFOLIO_ALERT_MAX_CASES);
    if (adverse.length === 0 && missed.length === 0) return null;
    const members = await tx
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, workspaceId), eq(member.status, 'active')))
      .orderBy(asc(member.userId));
    return { adverse, missed, members };
  });
  if (found === null) return report;
  report.adverse = found.adverse.length;
  report.missed = found.missed.length;

  const label = (c: { cnr: string | null; caseNumber: string | null }) =>
    c.cnr ?? c.caseNumber ?? 'a tracked case';
  const notices: {
    category: 'portfolio.adverse_order' | 'portfolio.missed_date';
    title: string;
    body: string;
    key: string;
  }[] = [
    ...found.adverse.map((c) => ({
      category: 'portfolio.adverse_order' as const,
      title: 'New adverse order in your portfolio',
      body: `An adverse order is recorded for ${label(c)}.`,
      key: `portfolio-adverse:${c.id}:${c.adverseRef ?? String(c.adverseAt?.getTime() ?? 0)}`,
    })),
    ...found.missed.map((c) => ({
      category: 'portfolio.missed_date' as const,
      title: 'Missed hearing date in your portfolio',
      body: `The next date ${c.nextDate ?? ''} of ${label(c)} has passed with no new date.`,
      key: `portfolio-missed:${c.id}:${c.nextDate ?? ''}`,
    })),
  ];
  const ctx = { db: deps.db, workspaceId, enqueueDelivery: deps.enqueueDelivery };
  for (const m of found.members) {
    for (const n of notices) {
      try {
        await notify(ctx, {
          userId: m.userId,
          category: n.category,
          title: n.title,
          body: n.body,
          dedupeKey: n.key,
        });
        report.notified += 1;
      } catch {
        // One failed notice (e.g. a delivery enqueue error) must not stop the others.
      }
    }
  }
  return report;
}
