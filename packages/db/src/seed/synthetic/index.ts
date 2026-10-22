// Synthetic matter sets (#386, part 1 of #40): the fictional Chennai-solo and Bengaluru-chamber
// matters the matters screens are built and measured on (500 matters / 1,500 proceedings at the
// defaults). Not registered in the seed registry: `pnpm db:seed` keeps seeding the 25-matter demo
// workspace (demo/), and stories, e2e and perf tests insert a set into a workspace of their own.
//
//   const set = syntheticMatterSet({ market: 'chennai-solo', workspaceId, forumIds, today });
//   await insertSyntheticMatterSet(db, set);
//
// Idempotent (fixed ids, `onConflictDoNothing`) and never in production.
import { isProd } from '@causedeck/config/env';

import { withWorkspace } from '../../rls.ts';
import { listing, obligation } from '../../schema/docket.ts';
import { matter } from '../../schema/matter-graph.ts';
import { person, roleEdge } from '../../schema/people.ts';
import { proceeding } from '../../schema/proceedings.ts';
import type { SeedDb } from '../index.ts';

import type { SyntheticMatterSet } from './matters.ts';

export {
  SYNTHETIC_DEFAULT_MATTERS,
  SYNTHETIC_DEFAULT_PROCEEDINGS_PER_MATTER,
  SYNTHETIC_FICTIONAL_SUFFIX,
  SYNTHETIC_MARKETS,
  syntheticMatterSet,
  type SyntheticMarket,
  type SyntheticMatterSet,
  type SyntheticMatterSetOptions,
} from './matters.ts';

export class SyntheticSeedInProductionError extends Error {
  override name = 'SyntheticSeedInProductionError';
  constructor() {
    super('The synthetic matter seed never runs when NODE_ENV=production.');
  }
}

/** Rows per insert statement, well under the protocol's bind-parameter limit. */
const CHUNK = 200;

async function insertChunks<T>(
  rows: readonly T[],
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < rows.length; start += CHUNK) {
    await insert(rows.slice(start, start + CHUNK));
  }
}

/** Insert a synthetic set into its workspace, parents first. A second run writes nothing. */
export async function insertSyntheticMatterSet(db: SeedDb, set: SyntheticMatterSet): Promise<void> {
  if (isProd()) throw new SyntheticSeedInProductionError();
  const mains = set.proceedings.filter((p) => p.parentProceedingId == null);
  const children = set.proceedings.filter((p) => p.parentProceedingId != null);
  await withWorkspace(db, { workspaceId: set.workspaceId }, async (tx) => {
    await insertChunks(set.matters, (c) => tx.insert(matter).values(c).onConflictDoNothing());
    await insertChunks(set.persons, (c) => tx.insert(person).values(c).onConflictDoNothing());
    await insertChunks(mains, (c) => tx.insert(proceeding).values(c).onConflictDoNothing());
    await insertChunks(children, (c) => tx.insert(proceeding).values(c).onConflictDoNothing());
    await insertChunks(set.roleEdges, (c) => tx.insert(roleEdge).values(c).onConflictDoNothing());
    await insertChunks(set.listings, (c) => tx.insert(listing).values(c).onConflictDoNothing());
    await insertChunks(set.obligations, (c) =>
      tx.insert(obligation).values(c).onConflictDoNothing(),
    );
  });
}
