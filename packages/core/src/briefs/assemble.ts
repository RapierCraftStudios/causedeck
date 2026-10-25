// Brief assembly (#60, ADR 0038): `assembleBrief` builds the per-listing preparation brief as a derived
// view over the docket, the anchored order extraction, the stored `brief_state` and the injected memory
// port. Nothing is stored. Every line carries its provenance and a line without any is dropped, never
// emitted. The role comes from the membership row (never the caller) and `can()` decides; M3 strategy
// and M4 court notes are left out server-side for a role without `strategy.read` and `memory.read`.
// This module also holds the plumbing the other briefs files share: the scope, the deps and the ports.
import type { AiGateway } from '@causedeck/ai';
import { isRole } from '@causedeck/auth';
import { can, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import {
  currentScope,
  isUuid,
  schema,
  withWorkspace,
  type Database,
  type Transaction,
} from '@causedeck/db';
import {
  Brief,
  MAX_CONTEXT_PASSAGES,
  hasProvenance,
  type BriefLine,
  type BriefState,
} from '@causedeck/validators';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { crossWorkspace } from '../matter-graph/index.ts';
import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import { carrySection } from './sections/carry.ts';
import { contextSection } from './sections/context.ts';
import { courtNotesSection } from './sections/court-notes.ts';
import { lastHearingSection } from './sections/last-hearing.ts';
import { lastOrderSection } from './sections/last-order.ts';
import { obligationsSection } from './sections/obligations.ts';
import { stageSection } from './sections/stage.ts';
import { synopsisSection } from './sections/synopsis.ts';

export type BriefStaleReason = 'new_order' | 'stage_changed' | 'new_obligation';

/** Events of the brief, emitted through an injected port once the scope has resolved. */
export type BriefEvent = {
  type: 'brief.stale';
  workspaceId: string;
  listingId: string;
  reason: BriefStaleReason;
};

export interface BriefEvents {
  emit(event: BriefEvent): void;
}

/** A line a memory item yields: the brief line's provenance, without the page link. */
export type MemoryLine = Omit<BriefLine, 'page_no' | 'quote'> & {
  page_no?: number | null;
  quote?: string | null;
};

export interface MemoryQuery {
  workspaceId: string;
  matterId: string;
  userId: string;
}

export interface MemoryNote {
  authorUserId: string;
  /** Chamber-shared notes are visible to every reader; the rest are author-private (M4). */
  shared: boolean;
  line: MemoryLine;
}

export interface MemorySynopsis {
  line: MemoryLine;
  strategy: MemoryLine | null;
}

export interface CarryRule {
  id: string;
  label: string;
}

/** The memory port (#72, #74 wire the real one): M2 always-carry rules, M3 synopsis, M4 court notes. */
export interface MemoryProvider {
  alwaysCarry(query: { workspaceId: string }): Promise<CarryRule[]>;
  synopsis(query: MemoryQuery): Promise<MemorySynopsis | null>;
  lastHearing(query: MemoryQuery): Promise<MemoryLine | null>;
  courtNotes(query: MemoryQuery): Promise<MemoryNote[]>;
}

/** Until memory is wired: nothing. */
export const emptyMemoryProvider: MemoryProvider = {
  alwaysCarry: async () => [],
  synopsis: async () => null,
  lastHearing: async () => null,
  courtNotes: async () => [],
};

export interface BriefDeps {
  db: Database | Transaction;
  /** Policy settings; the workspace's stored role settings apply when omitted. */
  settings?: PolicySettings;
  memory?: MemoryProvider;
  events?: BriefEvents;
  /** Defaults to the core gateway over the transaction (mock provider unless configured). */
  gateway?: AiGateway;
  now?: () => Date;
}

export interface BriefActor {
  workspaceId: string;
  userId: string;
}

export interface BriefScope {
  tx: Transaction;
  actor: Actor;
  deps: BriefDeps;
  now: Date;
  settings: () => Promise<PolicySettings>;
  emit: (event: BriefEvent) => void;
  /** The system refresh: no user, so no writer is recorded. */
  system?: boolean;
}

export interface AssembleOptions {
  /** Skip the AI compression of the last order (the deterministic brief only). */
  compress?: boolean;
  /** Free-text query for the document context; derived from the stage and open obligations when omitted. */
  contextQuery?: string;
}

/** The parsed input, or VALIDATION with the first issue's message. */
export function parseBriefInput<S extends z.ZodType>(schemaOf: S, input: unknown): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return parsed.data;
}

/** Run `fn` in the actor's workspace scope; emit its events once the scope has resolved. */
export async function inBriefScope<T>(
  deps: BriefDeps,
  actor: BriefActor,
  fn: (scope: BriefScope) => Promise<T>,
): Promise<T> {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) throw notFound('Workspace not found');
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== actor.workspaceId.toLowerCase()
  ) {
    throw crossWorkspace();
  }
  const events: BriefEvent[] = [];
  const { workspaceId, userId } = actor;
  const result = await withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw notFound('Workspace not found');
    let settings: PolicySettings | undefined = deps.settings;
    return fn({
      tx,
      actor: { userId, workspaceId, role },
      deps,
      now: (deps.now ?? (() => new Date()))(),
      settings: async () => (settings ??= toPolicySettings(await getRoleSettings(tx, workspaceId))),
      emit: (event) => events.push(event),
    });
  });
  for (const event of events) deps.events?.emit(event);
  return result;
}

/** FORBIDDEN unless the actor's role may `action` (no resource). */
export async function requireAction(
  scope: BriefScope,
  action: Parameters<typeof can>[1],
  message: string,
): Promise<void> {
  if (!(await mayDo(scope, action))) throw forbidden(message);
}

export async function mayDo(scope: BriefScope, action: Parameters<typeof can>[1]): Promise<boolean> {
  return can(scope.actor, action, undefined, await scope.settings()).allow;
}

/** The listing the brief is for, with its matter, or NOT_FOUND (RLS hides another workspace's). */
export interface ListingContext {
  listingId: string;
  proceedingId: string;
  matterId: string;
  sensitive: boolean;
  listDate: string;
  stageRaw: string;
  stageNorm: string | null;
  row: typeof schema.listing.$inferSelect;
}

export async function loadListing(scope: BriefScope, listingId: string): Promise<ListingContext> {
  const { tx, actor } = scope;
  const [row] = await tx
    .select({
      listing: schema.listing,
      matterId: schema.proceeding.matterId,
      sensitive: schema.matter.sensitive,
    })
    .from(schema.listing)
    .innerJoin(
      schema.proceeding,
      and(
        eq(schema.proceeding.workspaceId, schema.listing.workspaceId),
        eq(schema.proceeding.id, schema.listing.proceedingId),
      ),
    )
    .innerJoin(
      schema.matter,
      and(
        eq(schema.matter.workspaceId, schema.proceeding.workspaceId),
        eq(schema.matter.id, schema.proceeding.matterId),
      ),
    )
    .where(and(eq(schema.listing.workspaceId, actor.workspaceId), eq(schema.listing.id, listingId)))
    .limit(1);
  if (row === undefined) throw notFound('Listing not found');
  return {
    listingId,
    proceedingId: row.listing.proceedingId,
    matterId: row.matterId,
    sensitive: row.sensitive,
    listDate: row.listing.listDate,
    stageRaw: row.listing.stageRaw,
    stageNorm: row.listing.stageNorm,
    row: row.listing,
  };
}

/** The provenance fields of a docket row, with the numeric confidence as a number. */
export function provenanceOf(row: {
  sourceType: BriefLine['source_type'];
  sourceRef: string | null;
  anchorId: string | null;
  confidence: string | null;
  confirmationState: BriefLine['confirmation_state'];
}): Pick<
  BriefLine,
  'source_type' | 'source_ref' | 'anchor_id' | 'confidence' | 'confirmation_state'
> {
  return {
    source_type: row.sourceType,
    source_ref: row.sourceRef,
    anchor_id: row.anchorId,
    confidence: row.confidence === null ? null : Number(row.confidence),
    confirmation_state: row.confirmationState,
  };
}

/** Keep only lines that carry provenance: no provenance, no line. */
export function withProvenance<L extends Parameters<typeof hasProvenance>[0]>(lines: L[]): L[] {
  return lines.filter(hasProvenance);
}

/** A memory line as a brief line (page link defaults to none). */
export function toBriefLine(line: MemoryLine): BriefLine {
  return { ...line, page_no: line.page_no ?? null, quote: line.quote ?? null };
}

/** The stored brief state of a listing, or the empty state. */
export async function loadBriefState(scope: BriefScope, listingId: string): Promise<BriefState> {
  const [row] = await scope.tx
    .select()
    .from(schema.briefState)
    .where(
      and(
        eq(schema.briefState.workspaceId, scope.actor.workspaceId),
        eq(schema.briefState.listingId, listingId),
      ),
    )
    .limit(1);
  return {
    listing_id: listingId,
    prepared_by: row?.preparedBy ?? null,
    prepared_at: row?.preparedAt?.toISOString() ?? null,
    carry: row?.carry ?? [],
    note: row?.note ?? null,
  };
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
    await requireAction(scope, 'listing.read', 'You cannot read this listing');
    const listing = await loadListing(scope, listingId);
    const memory = deps.memory ?? emptyMemoryProvider;
    const query: MemoryQuery = {
      workspaceId: actor.workspaceId,
      matterId: listing.matterId,
      userId: actor.userId,
    };
    const state = await loadBriefState(scope, listingId);
    const canMemory = await mayDo(scope, 'memory.read');
    const canStrategy = await mayDo(scope, 'strategy.read');

    const order = await lastOrderSection(scope, listing, opts.compress !== false);
    const obligations = await obligationsSection(scope, listing);
    const carry = await carrySection(scope, listing, obligations.documentIds, state, memory);
    const context = listing.sensitive
      ? []
      : await contextSection(scope, listing, obligations.open, opts.contextQuery);
    const synopsis = canMemory ? await synopsisSection(memory, query, canStrategy) : null;
    const memoryHearing = canMemory ? await memory.lastHearing(query) : null;

    return Brief.parse({
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
  });
}
