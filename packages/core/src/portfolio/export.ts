// Portfolio CSV export (#663, part 3 of #498): every case of one portfolio, in next-date order,
// with spreadsheet formulas neutralised by `toCsv`.
import { schema, withWorkspace } from '@causedeck/db';
import { and, asc, eq, sql } from 'drizzle-orm';

import { loadPortfolio, requirePortfolioAccess, type Db, type PortfolioActor } from './access.ts';
import { toCsv } from './csv.ts';

const { portfolioCase } = schema;

export const PORTFOLIO_EXPORT_HEADER = [
  'cnr',
  'case_number',
  'source',
  'stage',
  'next_date',
  'last_adverse_order_at',
  'last_adverse_order_ref',
  'status_checked_at',
] as const;

export async function exportPortfolioCsv(
  deps: { db: Db },
  actor: PortfolioActor,
  input: { portfolioId: string },
): Promise<string> {
  await requirePortfolioAccess(deps.db, actor, { ownerOnly: false });
  await loadPortfolio(deps.db, actor, input.portfolioId);
  const rows = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .select()
      .from(portfolioCase)
      .where(
        and(
          eq(portfolioCase.workspaceId, actor.workspaceId),
          eq(portfolioCase.portfolioId, input.portfolioId),
        ),
      )
      .orderBy(sql`${portfolioCase.nextDate} asc nulls last`, asc(portfolioCase.id)),
  );
  return toCsv([
    [...PORTFOLIO_EXPORT_HEADER],
    ...rows.map((r) => [
      r.cnr,
      r.caseNumber,
      r.sourceId,
      r.status,
      r.nextDate,
      r.lastAdverseOrderAt?.toISOString() ?? null,
      r.lastAdverseOrderRef,
      r.statusCheckedAt?.toISOString() ?? null,
    ]),
  ]);
}
