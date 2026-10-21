// The canonical next date (#364, part 3 of #33; ADR 0016). A proceeding has at most one canonical
// listing, its next date (`listing_one_canonical_uq`, ADR 0013). This module is the only writer of
// `listing.list_date` and `listing.canonical` in packages/core; the `no-direct-listing-update`
// architecture test (__tests__/no-direct-listing-update.test.ts) fails the build otherwise.
//
// - `proposeNextDate` stores a date as a non-canonical `proposed` listing. It never changes the
//   canonical listing: a different date is returned as a conflict with both sides, and the
//   services never choose between two sources for a date (the conflict card does, through a
//   person). The same date as the canonical one is a no-op.
// - `confirmNextDate` is the only path that makes a listing canonical. In one transaction it
//   clears the old canonical row (which stays, as history) and then sets the new one: the index is
//   immediate. It needs a member who may write the matter, and refuses a date before today in
//   Asia/Kolkata unless `allowPast` is passed.
// - `getCanonicalNextDate` reads the canonical listing, if any.
// - `demoteDuplicateCanonical` and `restoreCanonical` serve `mergeProceedings` and its undo
//   (#365, merge-split.ts) inside their transaction, which has already checked `matter.write`.
//   They choose no date: the merge demotes the source's canonical listing only when it carries the
//   survivor's canonical date (two records of one next date), and refuses different dates. They are
//   internal to the domain (index.ts does not export them).
import { schema, type Transaction } from '@causedeck/db';
import {
  ConfirmNextDateInput,
  GetCanonicalNextDateInput,
  ProposeNextDateInput,
} from '@causedeck/validators/matter-graph-inputs';
import { and, eq, ne, sql } from 'drizzle-orm';

import { conflict, invalid, notFound } from '../shared/errors.ts';

import {
  inGraphScope,
  parseInput,
  pgError,
  requireMatter,
  type GraphActor,
  type MatterGraphDeps,
} from './context.ts';
import { graphNotFound } from './errors.ts';

const { listing, proceeding } = schema;

export type ListingRow = typeof listing.$inferSelect;

/** One side of a next-date result: a listing and where its date came from. */
export interface ListingRef {
  listingId: string;
  proceedingId: string;
  date: string;
  canonical: boolean;
  sourceType: ListingRow['sourceType'];
  confirmationState: ListingRow['confirmationState'];
}

/** A proposed date that differs from the canonical one; nothing canonical was changed. */
export interface NextDateConflict {
  kind: 'conflict';
  current: ListingRef;
  proposed: ListingRef;
}

export type NextDateResult =
  { kind: 'proposal'; listingId: string } | NextDateConflict | { kind: 'noop' };

/** Court dates are Indian: Asia/Kolkata has a fixed +05:30 offset. */
const COURT_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `at` as a `YYYY-MM-DD` day in Asia/Kolkata. */
function courtDay(at: Date): string {
  return COURT_DAY.format(at);
}

function toRef(row: ListingRow): ListingRef {
  return {
    listingId: row.id,
    proceedingId: row.proceedingId,
    date: row.listDate,
    canonical: row.canonical,
    sourceType: row.sourceType,
    confirmationState: row.confirmationState,
  };
}

/** The proceeding's matter, or NOT_FOUND outside the actor's workspace. */
async function matterOfProceeding(
  tx: Transaction,
  workspaceId: string,
  proceedingId: string,
): Promise<string> {
  const [row] = await tx
    .select({ matterId: proceeding.matterId })
    .from(proceeding)
    .where(and(eq(proceeding.workspaceId, workspaceId), eq(proceeding.id, proceedingId)))
    .limit(1);
  if (row === undefined) throw graphNotFound('proceeding');
  return row.matterId;
}

/** The proceeding's canonical listing, locked for the rest of the transaction. */
async function canonicalListing(
  tx: Transaction,
  workspaceId: string,
  proceedingId: string,
): Promise<ListingRow | undefined> {
  const [row] = await tx
    .select()
    .from(listing)
    .where(
      and(
        eq(listing.workspaceId, workspaceId),
        eq(listing.proceedingId, proceedingId),
        eq(listing.canonical, true),
      ),
    )
    .limit(1)
    .for('update');
  return row;
}

/**
 * Propose `date` as the proceeding's next date: a `proposal` when it has no canonical listing, a
 * `noop` for the canonical date, otherwise a `conflict` (the proposed side is stored, the
 * canonical listing is untouched). Needs `matter.write`.
 */
export async function proposeNextDate(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: ProposeNextDateInput,
): Promise<NextDateResult> {
  const data = parseInput(ProposeNextDateInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId, userId } = scope.actor;
    const matterId = await matterOfProceeding(tx, workspaceId, data.proceedingId);
    const owning = await requireMatter(scope, matterId, 'matter.write');
    const current = await canonicalListing(tx, workspaceId, data.proceedingId);
    if (current?.listDate === data.date) return { kind: 'noop' };
    const base = { workspaceId, actorUserId: userId, matterId, sensitive: owning.sensitive };
    if (current === undefined) {
      // Proposing the same date again finds the earlier proposal instead of adding another.
      const [earlier] = await tx
        .select({ id: listing.id })
        .from(listing)
        .where(
          and(
            eq(listing.workspaceId, workspaceId),
            eq(listing.proceedingId, data.proceedingId),
            eq(listing.canonical, false),
            eq(listing.listDate, data.date),
            eq(listing.confirmationState, 'proposed'),
          ),
        )
        .limit(1);
      if (earlier !== undefined) return { kind: 'proposal', listingId: earlier.id };
    }
    const { provenance } = data;
    let row: ListingRow | undefined;
    try {
      [row] = await tx
        .insert(listing)
        .values({
          workspaceId,
          proceedingId: data.proceedingId,
          listDate: data.date,
          listType: data.listType,
          stageRaw: data.stageRaw,
          listNo: data.listNo ?? null,
          itemNo: data.itemNo ?? null,
          sourceType: provenance.sourceType,
          sourceRef: provenance.sourceRef ?? null,
          anchorId: provenance.anchorId ?? null,
          confidence: provenance.confidence ?? null,
          confirmationState: 'proposed',
          ...(provenance.capturedAt === undefined ? {} : { capturedAt: provenance.capturedAt }),
        })
        .returning();
    } catch (error) {
      const { code, constraint } = pgError(error);
      if (code === '23503' && constraint === 'listing_anchor_fk') {
        throw invalid('provenance.anchorId: anchor not found');
      }
      if (code === '23514') throw invalid('The proposed listing is not consistent');
      throw error;
    }
    if (!row) throw new Error('proposeNextDate: insert returned no row');
    if (current === undefined) {
      scope.emit({
        ...base,
        type: 'listing.next_date_proposed',
        proceedingId: data.proceedingId,
        listingId: row.id,
        date: row.listDate,
      });
      return { kind: 'proposal', listingId: row.id };
    }
    scope.emit({
      ...base,
      type: 'listing.next_date_conflict',
      proceedingId: data.proceedingId,
      currentListingId: current.id,
      proposedListingId: row.id,
      currentDate: current.listDate,
      proposedDate: row.listDate,
    });
    return { kind: 'conflict', current: toRef(current), proposed: toRef(row) };
  });
}

/**
 * Make the listing its proceeding's canonical, confirmed next date. The previous canonical listing
 * keeps its row with `canonical = false`. Needs a member with `matter.write`; a date before today
 * (Asia/Kolkata) is VALIDATION unless `allowPast`.
 */
export async function confirmNextDate(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: ConfirmNextDateInput,
): Promise<ListingRow> {
  const data = parseInput(ConfirmNextDateInput, input);
  const today = courtDay((deps.now ?? (() => new Date()))());
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId, userId } = scope.actor;
    const [target] = await tx
      .select()
      .from(listing)
      .where(and(eq(listing.workspaceId, workspaceId), eq(listing.id, data.listingId)))
      .limit(1)
      .for('update');
    if (target === undefined) throw notFound('Listing not found');
    const matterId = await matterOfProceeding(tx, workspaceId, target.proceedingId);
    const owning = await requireMatter(scope, matterId, 'matter.write');
    if (!data.allowPast && target.listDate < today) {
      throw invalid('date: The next date is in the past; pass allowPast to confirm it');
    }
    if (target.canonical && target.confirmationState === 'confirmed') return target;
    const [previous] = await tx
      .select({ id: listing.id })
      .from(listing)
      .where(
        and(
          eq(listing.workspaceId, workspaceId),
          eq(listing.proceedingId, target.proceedingId),
          eq(listing.canonical, true),
          ne(listing.id, target.id),
        ),
      )
      .limit(1)
      .for('update');
    let row: ListingRow | undefined;
    try {
      if (previous !== undefined) {
        await tx
          .update(listing)
          .set({ canonical: false, updatedAt: new Date() })
          .where(and(eq(listing.workspaceId, workspaceId), eq(listing.id, previous.id)));
      }
      [row] = await tx
        .update(listing)
        .set({ canonical: true, confirmationState: 'confirmed', updatedAt: new Date() })
        .where(and(eq(listing.workspaceId, workspaceId), eq(listing.id, target.id)))
        .returning();
    } catch (error) {
      if (pgError(error).code === '23505') {
        throw conflict('The next date of this proceeding changed meanwhile');
      }
      throw error;
    }
    if (!row) throw new Error('confirmNextDate: update returned no row');
    scope.emit({
      type: 'listing.next_date_confirmed',
      workspaceId,
      actorUserId: userId,
      matterId,
      sensitive: owning.sensitive,
      proceedingId: row.proceedingId,
      listingId: row.id,
      previousListingId: previous?.id ?? null,
      date: row.listDate,
    });
    return row;
  });
}

/** The proceeding's canonical listing (its next date), or null. Needs `matter.read`; reads only. */
export async function getCanonicalNextDate(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: GetCanonicalNextDateInput,
): Promise<ListingRow | null> {
  const { proceedingId } = parseInput(GetCanonicalNextDateInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId } = scope.actor;
    const matterId = await matterOfProceeding(tx, workspaceId, proceedingId);
    await requireMatter(scope, matterId, 'matter.read');
    const [row] = await tx
      .select()
      .from(listing)
      .where(
        and(
          eq(listing.workspaceId, workspaceId),
          eq(listing.proceedingId, proceedingId),
          eq(listing.canonical, true),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}

/**
 * For `mergeProceedings` (#365): clear the canonical flag of `listingId`, the merged-away
 * proceeding's canonical listing, which carries the same date as the survivor's. Refuses (CONFLICT)
 * a listing that is not canonical or whose date differs from `sameDateAs`.
 */
export async function demoteDuplicateCanonical(
  tx: Transaction,
  workspaceId: string,
  listingId: string,
  sameDateAs: string,
): Promise<void> {
  const [row] = await tx
    .update(listing)
    .set({ canonical: false, updatedAt: new Date() })
    .where(
      and(
        eq(listing.workspaceId, workspaceId),
        eq(listing.id, listingId),
        eq(listing.canonical, true),
        eq(listing.listDate, sameDateAs),
      ),
    )
    .returning({ id: listing.id });
  if (row === undefined) throw conflict('The next date of this proceeding changed meanwhile');
}

/**
 * For `undoMergeProceedings` (#365): make `listingId` canonical again, as it was before the merge,
 * with its recorded `updated_at`. CONFLICT when its proceeding has another canonical listing now.
 */
export async function restoreCanonical(
  tx: Transaction,
  workspaceId: string,
  listingId: string,
  updatedAt: string,
): Promise<void> {
  try {
    await tx
      .update(listing)
      .set({ canonical: true, updatedAt: sql`${updatedAt}::timestamptz` })
      .where(and(eq(listing.workspaceId, workspaceId), eq(listing.id, listingId)));
  } catch (error) {
    if (pgError(error).code === '23505') {
      throw conflict('The next date of this proceeding changed meanwhile');
    }
    throw error;
  }
}
