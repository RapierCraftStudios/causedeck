// Who may use a portfolio (#663): importing is owner-only, reads are for any active member. The
// portfolio is looked up inside the actor's workspace scope, so another workspace's id is not found.
import { isUuid, schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import { forbidden, notFound } from '../shared/errors.ts';
import { memberRole } from '../workspaces/index.ts';

export type Db = Database | Transaction;

export interface PortfolioActor {
  userId: string;
  workspaceId: string;
}

/** The actor's membership (NOT_FOUND when none, FORBIDDEN when `ownerOnly` and not an owner). */
export async function requirePortfolioAccess(
  db: Db,
  actor: PortfolioActor,
  opts: { ownerOnly: boolean },
): Promise<void> {
  const role = await memberRole(db, actor.userId, actor.workspaceId);
  if (role === null) throw notFound('Portfolio not found');
  if (opts.ownerOnly && role !== 'owner') throw forbidden();
}

/** The portfolio row of the actor's workspace; NOT_FOUND otherwise. */
export async function loadPortfolio(db: Db, actor: PortfolioActor, portfolioId: string) {
  if (!isUuid(portfolioId)) throw notFound('Portfolio not found');
  const [row] = await withWorkspace(db, actor, (tx) =>
    tx
      .select()
      .from(schema.portfolio)
      .where(
        and(
          eq(schema.portfolio.workspaceId, actor.workspaceId),
          eq(schema.portfolio.id, portfolioId),
        ),
      ),
  );
  if (row === undefined) throw notFound('Portfolio not found');
  return row;
}
