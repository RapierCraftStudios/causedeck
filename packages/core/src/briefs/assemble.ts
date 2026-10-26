// Brief assembly (#60, ADR 0038): `assembleBrief` builds the per-listing preparation brief as a derived
// view over the docket, the anchored order extraction, the stored `brief_state` and the injected memory
// port. Nothing is stored. Every line carries its provenance and a line without any is dropped, never
// emitted. The role comes from the membership row (never the caller) and `can()` decides; M3 strategy
// and M4 court notes are left out server-side for a role without `strategy.read` and `memory.read`.
import { isUuid } from '@causedeck/db';
import { Brief, MAX_CONTEXT_PASSAGES } from '@causedeck/validators';

import { notFound } from '../shared/errors.ts';

import {
  emptyMemoryProvider,
  inBriefScope,
  loadBriefState,
  loadListing,
  mayDo,
  requireBriefAction,
  type BriefActor,
  type BriefDeps,
  type MemoryQuery,
} from './scope.ts';
import { applyBriefFormat } from './memory-provider.ts';
import { carrySection } from './sections/carry.ts';
import { contextSection } from './sections/context.ts';
import { courtNotesSection } from './sections/court-notes.ts';
import { lastHearingSection } from './sections/last-hearing.ts';
import { lastOrderSection } from './sections/last-order.ts';
import { obligationsSection } from './sections/obligations.ts';
import { stageSection } from './sections/stage.ts';
import { synopsisSection } from './sections/synopsis.ts';

export interface AssembleOptions {
  /** Skip the AI compression of the last order (the deterministic brief only). */
  compress?: boolean;
  /** Free-text query for the document context; derived from the stage and open obligations when omitted. */
  contextQuery?: string;
}

/** The derived brief of a listing (needs `listing.read`). Writes nothing. */
export async function assembleBrief(
  deps: BriefDeps,
  actor: BriefActor,
  listingId: string,
  opts: AssembleOptions = {},
): Promise<Brief> {
  if (!isUuid(listingId)) throw notFound('Listing not found');
  return inBriefScope(deps, actor, async (scope) => {
    await requireBriefAction(scope, 'listing.read', 'You cannot read this listing');
    const listing = await loadListing(scope, listingId);
    const memory = deps.memory ?? emptyMemoryProvider;
    const query: MemoryQuery = {
      workspaceId: actor.workspaceId,
      matterId: listing.matterId,
      userId: actor.userId,
      listingId,
    };
    const state = await loadBriefState(scope, listingId);
    const canMemory = await mayDo(scope, 'memory.read');
    const canStrategy = await mayDo(scope, 'strategy.read');

    const order = await lastOrderSection(scope, listing, opts.compress !== false);
    const obligations = await obligationsSection(scope, listing);
    const carry = await carrySection(
      scope,
      listing,
      obligations.documentIds,
      state,
      memory,
      query,
    );
    const context = listing.sensitive
      ? []
      : await contextSection(scope, listing, obligations.open, opts.contextQuery);
    const synopsis = canMemory ? await synopsisSection(memory, query, canStrategy) : null;
    const memoryHearing = canMemory ? await memory.lastHearing(query) : null;

    const format = (await memory.format?.(query)) ?? null;

    const brief = Brief.parse({
      listing_id: listingId,
      matter_id: listing.matterId,
      proceeding_id: listing.proceedingId,
      assembled_at: scope.now.toISOString(),
      sensitive: listing.sensitive,
      ai_used: order.aiUsed,
      stage: stageSection(listing),
      last_order: order.lines,
      obligations: { open: obligations.open, closed_count: obligations.closedCount },
      carry: carry.items,
      synopsis,
      last_hearing: await lastHearingSection(scope, listing, memoryHearing),
      court_notes:
        canMemory && canStrategy ? await courtNotesSection(memory, query, actor.userId) : null,
      context: context.slice(0, MAX_CONTEXT_PASSAGES),
      prepared:
        state.prepared_at === null ? null : { by: state.prepared_by, at: state.prepared_at },
      note: state.note,
      carry_reviewed: carry.reviewed,
    });
    return applyBriefFormat(brief, format);
  });
}
