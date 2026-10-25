// Portfolio dashboard queries (#663, part 3 of #498): the cases of one portfolio with their next
// dates, stage and last adverse order, filtered and paged, and a summary. Reads only; the status
// fields are written by the poll and the alerts of later parts.
import { schema, withWorkspace } from '@causedeck/db';
import { and, asc, eq, gte, isNotNull, lte, sql, type SQL } from 'drizzle-orm';

import { invalid } from '../shared/errors.ts';

import { loadPortfolio, requirePortfolioAccess, type Db, type PortfolioActor } from './access.ts';

const { portfolioCase } = schema;

export type PortfolioCaseRow = typeof portfolioCase.$inferSelect;

export const DEFAULT_PORTFOLIO_PAGE = 100;
export const MAX_PORTFOLIO_PAGE = 500;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ListPortfolioCasesInput {
  portfolioId: string;
  /** Exact stage text as the source prints it. */
  stage?: string;
  /** Next date window, `YYYY-MM-DD`, inclusive. */
  nextFrom?: string;
  nextTo?: string;
  /** Only cases with a recorded adverse order. */
  adverseOnly?: boolean;
  limit?: number;
  offset?: number;
}

function checkDate(value: string | undefined): void {
  if (value !== undefined && !DATE.test(value)) throw invalid('Dates are YYYY-MM-DD');
}

/** Cases ordered by next date (undated last), then id. */
export async function listPortfolioCases(
  deps: { db: Db },
  actor: PortfolioActor,
  input: ListPortfolioCasesInput,
): Promise<PortfolioCaseRow[]> {
  checkDate(input.nextFrom);
  checkDate(input.nextTo);
  const limit = input.limit ?? DEFAULT_PORTFOLIO_PAGE;
  const offset = input.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PORTFOLIO_PAGE) {
    throw invalid(`A page holds 1 to ${String(MAX_PORTFOLIO_PAGE)} cases`);
  }
  if (!Number.isInteger(offset) || offset < 0) throw invalid('Offset must be 0 or more');
  await requirePortfolioAccess(deps.db, actor, { ownerOnly: false });
  await loadPortfolio(deps.db, actor, input.portfolioId);
  const where: SQL[] = [
    eq(portfolioCase.workspaceId, actor.workspaceId),
    eq(portfolioCase.portfolioId, input.portfolioId),
  ];
  if (input.stage !== undefined) where.push(eq(portfolioCase.status, input.stage));
  if (input.nextFrom !== undefined) where.push(gte(portfolioCase.nextDate, input.nextFrom));
  if (input.nextTo !== undefined) where.push(lte(portfolioCase.nextDate, input.nextTo));
  if (input.adverseOnly === true) where.push(isNotNull(portfolioCase.lastAdverseOrderAt));
  return withWorkspace(deps.db, actor, (tx) =>
    tx
      .select()
      .from(portfolioCase)
      .where(and(...where))
      .orderBy(sql`${portfolioCase.nextDate} asc nulls last`, asc(portfolioCase.id))
      .limit(limit)
      .offset(offset),
  );
}

export interface PortfolioSummary {
  total: number;
  /** Cases per stage text; `null` is a case with no stage yet. */
  byStage: { stage: string | null; count: number }[];
  withAdverseOrder: number;
  /** Cases whose next date is `today` or within the next 7 days. */
  upcoming: number;
  /** Cases with a next date before `today`. */
  overdue: number;
}

export async function portfolioSummary(
  deps: { db: Db; now?: () => Date },
  actor: PortfolioActor,
  input: { portfolioId: string },
): Promise<PortfolioSummary> {
  await requirePortfolioAccess(deps.db, actor, { ownerOnly: false });
  await loadPortfolio(deps.db, actor, input.portfolioId);
  const today = (deps.now ?? (() => new Date()))().toISOString().slice(0, 10);
  const week = new Date(`${today}T00:00:00Z`);
  week.setUTCDate(week.getUTCDate() + 7);
  const weekEnd = week.toISOString().slice(0, 10);
  return withWorkspace(deps.db, actor, async (tx) => {
    const mine = and(
      eq(portfolioCase.workspaceId, actor.workspaceId),
      eq(portfolioCase.portfolioId, input.portfolioId),
    );
    const stages = await tx
      .select({ stage: portfolioCase.status, count: sql<number>`count(*)::int` })
      .from(portfolioCase)
      .where(mine)
      .groupBy(portfolioCase.status)
      .orderBy(asc(portfolioCase.status));
    const [totals] = await tx
      .select({
        adverse: sql<number>`count(*) filter (where ${portfolioCase.lastAdverseOrderAt} is not null)::int`,
        upcoming: sql<number>`count(*) filter (where ${portfolioCase.nextDate} >= ${today} and ${portfolioCase.nextDate} <= ${weekEnd})::int`,
        overdue: sql<number>`count(*) filter (where ${portfolioCase.nextDate} < ${today})::int`,
      })
      .from(portfolioCase)
      .where(mine);
    return {
      total: stages.reduce((n, s) => n + s.count, 0),
      byStage: stages,
      withAdverseOrder: totals?.adverse ?? 0,
      upcoming: totals?.upcoming ?? 0,
      overdue: totals?.overdue ?? 0,
    };
  });
}
