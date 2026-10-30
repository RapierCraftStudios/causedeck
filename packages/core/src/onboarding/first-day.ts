// The first court-day view (#92): where the wizard ends. The next listed day is the earliest list
// date on or after today (IST) that has an item in this workspace; the counts say how many briefs
// are ready (one per listing, derived when opened) and how many open obligations the imported
// orders left in the starter queue. Counts only, never matter content.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, count, eq, gte, min } from 'drizzle-orm';

import { istDay } from '../import/index.ts';
import { notFound } from '../shared/errors.ts';
import { memberRole } from '../workspaces/index.ts';

import type { OnboardingActor } from './state.ts';

const { listing, obligation } = schema;

export interface FirstCourtDay {
  /** `YYYY-MM-DD`, or `null` when nothing is listed on or after today. */
  date: string | null;
  /** Listings on that day: one brief each. */
  briefs: number;
  /** Open obligations in the workspace: the starter queue drawn from imported orders. */
  openObligations: number;
}

export async function getFirstCourtDay(
  db: Database | Transaction,
  actor: OnboardingActor,
  now: Date = new Date(),
): Promise<FirstCourtDay> {
  if ((await memberRole(db, actor.userId, actor.workspaceId)) === null) {
    throw notFound('Workspace not found');
  }
  const today = istDay(now);
  return withWorkspace(db, actor, async (tx) => {
    const [first] = await tx
      .select({ date: min(listing.listDate) })
      .from(listing)
      .where(and(eq(listing.workspaceId, actor.workspaceId), gte(listing.listDate, today)));
    const date = first?.date ?? null;
    const [briefs] =
      date === null
        ? [{ value: 0 }]
        : await tx
            .select({ value: count() })
            .from(listing)
            .where(and(eq(listing.workspaceId, actor.workspaceId), eq(listing.listDate, date)));
    const [open] = await tx
      .select({ value: count() })
      .from(obligation)
      .where(and(eq(obligation.workspaceId, actor.workspaceId), eq(obligation.status, 'open')));
    return { date, briefs: briefs?.value ?? 0, openObligations: open?.value ?? 0 };
  });
}
