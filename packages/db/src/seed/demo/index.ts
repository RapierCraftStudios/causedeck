// The demo seed (#182): the fictional `demo` workspace with three members and 25 Madras HC and
// Bengaluru matters, so the app can be explored end to end in dev, preview and e2e. Run it with
// `pnpm db:seed:demo` (owner role) or as part of `pnpm db:seed` (profile `demo`).
//
// - Fictional only: every name ends in "(fictional)", case numbers are `DEMO-NNNN`, no CNR or
//   neutral citation, `.test` emails.
// - Idempotent: fixed ids and `onConflictDoNothing`, so a second run writes nothing. Dates are
//   offsets from the seed day (Asia/Kolkata), so "today" rows drift on later days until the
//   database is reset (`pnpm stack:reset`).
// - Never in production: `seedDemo` refuses when `NODE_ENV=production`.
// - Not here yet: storing the order PDFs in the bucket (`@causedeck/db` cannot depend on
//   `@causedeck/storage`), notes and activity items (no tables yet) and the screens that read this
//   data. The full demo mode is #93.
import { isProd } from '@causedeck/config/env';

import { withWorkspace } from '../../rls.ts';
import { member, organization, user } from '../../schema/auth.ts';
import { bench, courtHall, forum } from '../../schema/court.ts';
import { hearing, listing, obligation, order, task } from '../../schema/docket.ts';
import { anchor, document } from '../../schema/documents.ts';
import { matter } from '../../schema/matter-graph.ts';
import { person, roleEdge } from '../../schema/people.ts';
import { proceeding, proceedingLink } from '../../schema/proceedings.ts';
import { registerSeed, type SeedDb } from '../index.ts';

import { demoCourtRows } from './courts.ts';
import { demoMatterRows } from './matters.ts';
import { DEMO_USERS, DEMO_WORKSPACE } from './people.ts';
import { DEMO_WORKSPACE_ID, kolkataToday, seedInstant } from './shared.ts';

export { DEMO_FORUM_KEYS, forumId as demoForumId, type DemoForumKey } from './courts.ts';
export { DEMO_MATTER_COUNT, demoCaseNumber, demoMatterRows } from './matters.ts';
export { DEMO_PDF_HEADING, demoOrderPdf } from './pdf.ts';
export { DEMO_USERS, DEMO_WORKSPACE, demoMember, type DemoUser } from './people.ts';
export { addDays, DEMO_WORKSPACE_ID, FICTIONAL_SUFFIX, kolkataToday } from './shared.ts';

export interface SeedDemoOptions {
  /** The seed day (`yyyy-mm-dd`); defaults to today in Asia/Kolkata. Tests pin it. */
  today?: string;
}

export class DemoSeedInProductionError extends Error {
  override name = 'DemoSeedInProductionError';
  constructor() {
    super('The demo seed never runs when NODE_ENV=production.');
  }
}

/** Seed the demo workspace. A second run is a no-op. */
export async function seedDemo(db: SeedDb, { today }: SeedDemoOptions = {}): Promise<void> {
  if (isProd()) throw new DemoSeedInProductionError();
  const day = today ?? kolkataToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new TypeError(`seedDemo: bad day ${day}`);
  const at = seedInstant(day);
  const courts = demoCourtRows(at);
  const graph = demoMatterRows(day, at);

  await db
    .insert(user)
    .values(
      DEMO_USERS.map((u) => ({
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

  await withWorkspace(db, { workspaceId: DEMO_WORKSPACE_ID }, async (tx) => {
    await tx
      .insert(organization)
      .values({ ...DEMO_WORKSPACE, createdAt: at })
      .onConflictDoNothing();
    await tx
      .insert(member)
      .values(
        DEMO_USERS.map((u) => ({
          id: u.memberId,
          organizationId: DEMO_WORKSPACE_ID,
          userId: u.id,
          role: u.role,
          joinedAt: at,
          roleGrantedAt: at,
          createdAt: at,
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
    await tx.insert(proceedingLink).values(graph.proceedingLinks).onConflictDoNothing();
    await tx.insert(document).values(graph.documents).onConflictDoNothing();
    await tx.insert(anchor).values(graph.anchors).onConflictDoNothing();
    await tx.insert(order).values(graph.orders).onConflictDoNothing();
    await tx.insert(listing).values(graph.listings).onConflictDoNothing();
    await tx.insert(hearing).values(graph.hearings).onConflictDoNothing();
    await tx.insert(obligation).values(graph.obligations).onConflictDoNothing();
    await tx.insert(task).values(graph.tasks).onConflictDoNothing();
  });
}

registerSeed({
  name: 'demo-workspace',
  profiles: ['demo'],
  order: 20,
  run: (db) => seedDemo(db),
});
