// A workspace with a matter and a proceeding for the calendar tests (#53), plus the deps the
// matter-graph and automation services take. The clock is fixed so dates are stable.
import { type Transaction } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import { buildForum } from '@causedeck/db/testing/matter-graph-fixtures';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import {
  createMatter,
  createProceeding,
  type GraphEvent,
  type MatterGraphDeps,
} from '../../index.ts';

export const NOW = new Date('2026-10-21T06:00:00Z');

export interface World {
  tx: Transaction;
  workspaceId: string;
  ownerId: string;
  owner: { userId: string; workspaceId: string };
  events: GraphEvent[];
  deps: MatterGraphDeps;
  clock: { now: Date };
  forumId: string;
  matterId: string;
  /** `W.P. 101/2026` of that matter. */
  proceedingId: string;
}

export async function world(tx: Transaction): Promise<World> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const clock = { now: NOW };
  const events: GraphEvent[] = [];
  const deps: MatterGraphDeps = {
    db: tx,
    events: { emit: (e) => events.push(e) },
    now: () => clock.now,
  };
  const owner = { userId: ownerId, workspaceId };
  const matter = await createMatter(deps, owner, { title: 'Ilango v. State (fictional)' });
  const proceeding = await createProceeding(deps, owner, {
    matterId: matter.id,
    forumId: forum.id,
    caseType: 'W.P.',
    number: '101',
    year: 2026,
    provenance: { sourceType: 'manual' },
  });
  events.length = 0;
  return {
    tx,
    workspaceId,
    ownerId,
    owner,
    events,
    deps,
    clock,
    forumId: forum.id,
    matterId: matter.id,
    proceedingId: proceeding.id,
  };
}
