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
import { proposal } from '../../schema/automation.ts';
import { capture } from '../../schema/capture.ts';
import { hearing, listing, obligation, order } from '../../schema/docket.ts';
import { anchor, document } from '../../schema/documents.ts';
import { matter } from '../../schema/matter-graph.ts';
import { person, roleEdge } from '../../schema/people.ts';
import { proceeding, proceedingLink, proceedingStateChange } from '../../schema/proceedings.ts';
import type { SeedDb } from '../index.ts';

import type { SyntheticInbox } from './inbox.ts';
import type { SyntheticMatterTimeline } from './matter-timeline.ts';
import type { SyntheticMatterSet } from './matters.ts';

export {
  SYNTHETIC_INBOX_CAPTURES,
  SYNTHETIC_INBOX_PROPOSALS,
  syntheticInbox,
  type SyntheticInbox,
  type SyntheticInboxOptions,
} from './inbox.ts';

export {
  SYNTHETIC_TIMELINE_EVENTS,
  SYNTHETIC_TIMELINE_MISC_CHILDREN,
  SYNTHETIC_TIMELINE_PROCEEDINGS,
  syntheticMatterTimeline,
  syntheticTimelineEventCount,
  type SyntheticMatterTimeline,
  type SyntheticMatterTimelineOptions,
} from './matter-timeline.ts';

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

/**
 * Insert the synthetic timeline matter (#41) into its workspace, parents first. A second run
 * writes nothing.
 */
export async function insertSyntheticMatterTimeline(
  db: SeedDb,
  set: SyntheticMatterTimeline,
): Promise<void> {
  if (isProd()) throw new SyntheticSeedInProductionError();
  const mains = set.proceedings.filter((p) => p.parentProceedingId == null);
  const children = set.proceedings.filter((p) => p.parentProceedingId != null);
  await withWorkspace(db, { workspaceId: set.workspaceId }, async (tx) => {
    await tx.insert(matter).values(set.matters).onConflictDoNothing();
    await tx.insert(person).values(set.persons).onConflictDoNothing();
    await tx.insert(proceeding).values(mains).onConflictDoNothing();
    await tx.insert(proceeding).values(children).onConflictDoNothing();
    await tx.insert(roleEdge).values(set.roleEdges).onConflictDoNothing();
    await tx.insert(proceedingLink).values(set.proceedingLinks).onConflictDoNothing();
    await tx.insert(document).values(set.documents).onConflictDoNothing();
    await tx.insert(anchor).values(set.anchors).onConflictDoNothing();
    await tx.insert(listing).values(set.listings).onConflictDoNothing();
    await tx.insert(hearing).values(set.hearings).onConflictDoNothing();
    await tx.insert(order).values(set.orders).onConflictDoNothing();
    await tx.insert(obligation).values(set.obligations).onConflictDoNothing();
    await tx.insert(proceedingStateChange).values(set.stateChanges).onConflictDoNothing();
  });
}

/** Insert the synthetic inbox (#48) into its workspace. A second run writes nothing. */
export async function insertSyntheticInbox(db: SeedDb, set: SyntheticInbox): Promise<void> {
  if (isProd()) throw new SyntheticSeedInProductionError();
  await withWorkspace(db, { workspaceId: set.workspaceId }, async (tx) => {
    await tx.insert(capture).values(set.captures).onConflictDoNothing();
    await tx.insert(proposal).values(set.proposals).onConflictDoNothing();
  });
}
