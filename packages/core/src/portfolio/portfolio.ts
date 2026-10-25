// The portfolios of an institution workspace (#666, part 6 of #498): any active member lists them,
// an owner creates one. Cases, watches and dashboards hang off a portfolio id (#663); this is how a
// caller gets that id.
import { schema, withWorkspace } from '@causedeck/db';
import { asc, eq } from 'drizzle-orm';

import { conflict, invalid } from '../shared/errors.ts';

import { requirePortfolioAccess, type Db, type PortfolioActor } from './access.ts';

const { portfolio } = schema;

export interface PortfolioSummaryRow {
  id: string;
  name: string;
  createdAt: Date;
}

/** The workspace's portfolios, oldest first. NOT_FOUND to a non-member. */
export async function listPortfolios(
  deps: { db: Db },
  actor: PortfolioActor,
): Promise<PortfolioSummaryRow[]> {
  await requirePortfolioAccess(deps.db, actor, { ownerOnly: false });
  return withWorkspace(deps.db, actor, (tx) =>
    tx
      .select({ id: portfolio.id, name: portfolio.name, createdAt: portfolio.createdAt })
      .from(portfolio)
      .where(eq(portfolio.workspaceId, actor.workspaceId))
      .orderBy(asc(portfolio.createdAt), asc(portfolio.id)),
  );
}

/** Creates a portfolio (owner only). CONFLICT when the workspace already has one by that name. */
export async function createPortfolio(
  deps: { db: Db },
  actor: PortfolioActor,
  input: { name: string },
): Promise<PortfolioSummaryRow> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 200)
    throw invalid('A portfolio name is 1 to 200 characters');
  await requirePortfolioAccess(deps.db, actor, { ownerOnly: true });
  return withWorkspace(deps.db, actor, async (tx) => {
    const existing = await tx
      .select({ id: portfolio.id, name: portfolio.name })
      .from(portfolio)
      .where(eq(portfolio.workspaceId, actor.workspaceId));
    if (existing.some((row) => row.name === name)) throw conflict('That portfolio already exists');
    const [row] = await tx
      .insert(portfolio)
      .values({ workspaceId: actor.workspaceId, name, createdBy: actor.userId })
      .returning({ id: portfolio.id, name: portfolio.name, createdAt: portfolio.createdAt });
    if (row === undefined) throw new Error('portfolio insert returned no row');
    return row;
  });
}
