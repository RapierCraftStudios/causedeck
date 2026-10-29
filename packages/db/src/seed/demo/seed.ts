// Writing the demo workspaces (#93): see index.ts for the contract.
import { isProd } from '@causedeck/config/env';

import { withWorkspace } from '../../rls.ts';
import { member, organization, user } from '../../schema/auth.ts';
import { bench, courtHall, forum } from '../../schema/court.ts';
import { hearing, listing, obligation, order, task } from '../../schema/docket.ts';
import { anchor, document } from '../../schema/documents.ts';
import { workspaceFeatureFlag } from '../../schema/flags.ts';
import { matter } from '../../schema/matter-graph.ts';
import { person, roleEdge } from '../../schema/people.ts';
import { proceeding, proceedingLink } from '../../schema/proceedings.ts';
import { workspaceSettings } from '../../schema/workspace.ts';
import type { SeedDb } from '../index.ts';

import { demoCourtRows } from './courts.ts';
import { demoMatterRows } from './matters.ts';
import { DEMO_VERSION } from './meta.ts';
import { demoOrganization, demoUsers } from './people.ts';
import { kolkataToday, seedInstant } from './shared.ts';
import { DEMO_WORKSPACE_KEYS, demoWorkspace, type DemoWorkspaceKey } from './workspaces.ts';

export interface SeedDemoOptions {
  /** The seed day (`yyyy-mm-dd`); defaults to today in Asia/Kolkata. Tests pin it. */
  today?: string;
  /** Which workspaces; default both. */
  workspaces?: readonly DemoWorkspaceKey[];
}

export class DemoSeedInProductionError extends Error {
  override name = 'DemoSeedInProductionError';
  constructor() {
    super('The demo seed never runs when NODE_ENV=production.');
  }
}

/** Flags the demo workspaces have on (`m5_playbooks`: default off everywhere else, #901). */
export const DEMO_FLAG_OVERRIDES = ['m5_playbooks'] as const;

function checkDay(today: string | undefined): string {
  const day = today ?? kolkataToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new TypeError(`seedDemo: bad day ${day}`);
  return day;
}

/**
 * Write one demo workspace for the seed day `today`: a no-op for rows that exist. It does not look
 * at `NODE_ENV`: the nightly reset restores demo workspaces that already exist in any environment,
 * while `seedDemo` (the command) is the one that refuses production.
 */
export async function seedDemoWorkspace(
  db: SeedDb,
  key: DemoWorkspaceKey,
  { today }: { today?: string } = {},
): Promise<void> {
  const day = checkDay(today);
  const ws = demoWorkspace(key);
  const at = seedInstant(day);
  const courts = demoCourtRows(ws, at);
  const graph = demoMatterRows(ws, day, at);
  const users = demoUsers(ws);

  await db
    .insert(user)
    .values(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: true,
        locale: 'en',
        createdAt: at,
        updatedAt: at,
      })),
    )
    .onConflictDoNothing();

  await withWorkspace(db, { workspaceId: ws.id }, async (tx) => {
    await tx
      .insert(organization)
      .values({ ...demoOrganization(ws), createdAt: at })
      .onConflictDoNothing();
    await tx
      .insert(workspaceSettings)
      .values({
        workspaceId: ws.id,
        practiceCity: ws.practiceCity,
        demoVersion: DEMO_VERSION,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing();
    await tx
      .insert(member)
      .values(
        users.map((u) => ({
          id: u.memberId,
          organizationId: ws.id,
          userId: u.id,
          role: u.role,
          joinedAt: at,
          roleGrantedAt: at,
          createdAt: at,
        })),
      )
      .onConflictDoNothing();
    await tx
      .insert(workspaceFeatureFlag)
      .values(
        DEMO_FLAG_OVERRIDES.map((flag) => ({
          workspaceId: ws.id,
          key: flag,
          enabled: true,
          updatedAt: at,
        })),
      )
      .onConflictDoNothing();
    // Parents before children; each batch is a single statement.
    await tx.insert(forum).values(courts.forums).onConflictDoNothing();
    await tx.insert(courtHall).values(courts.halls).onConflictDoNothing();
    await tx.insert(bench).values(courts.benches).onConflictDoNothing();
    await tx.insert(matter).values(graph.matters).onConflictDoNothing();
    await tx.insert(person).values(graph.persons).onConflictDoNothing();
    await tx.insert(roleEdge).values(graph.roleEdges).onConflictDoNothing();
    for (const row of graph.proceedings) {
      // One at a time: children reference parents inserted just before them.
      await tx.insert(proceeding).values(row).onConflictDoNothing();
    }
    if (graph.proceedingLinks.length > 0) {
      await tx.insert(proceedingLink).values(graph.proceedingLinks).onConflictDoNothing();
    }
    await tx.insert(document).values(graph.documents).onConflictDoNothing();
    await tx.insert(anchor).values(graph.anchors).onConflictDoNothing();
    await tx.insert(order).values(graph.orders).onConflictDoNothing();
    await tx.insert(listing).values(graph.listings).onConflictDoNothing();
    await tx.insert(hearing).values(graph.hearings).onConflictDoNothing();
    await tx.insert(obligation).values(graph.obligations).onConflictDoNothing();
    await tx.insert(task).values(graph.tasks).onConflictDoNothing();
  });
}

/** Seed the demo workspaces (both by default). A second run is a no-op. */
export async function seedDemo(db: SeedDb, options: SeedDemoOptions = {}): Promise<void> {
  if (isProd()) throw new DemoSeedInProductionError();
  const day = checkDay(options.today);
  for (const key of options.workspaces ?? DEMO_WORKSPACE_KEYS) {
    await seedDemoWorkspace(db, key, { today: day });
  }
}
