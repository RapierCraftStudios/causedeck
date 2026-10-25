// Delegated case-status lookups (#591, D-048 tier 4 as amended): the server path of a watch. A
// lookup runs only for the advocate's own watch (`advocate_user_id` is the actor, the proceeding's
// matter is the `delegatedFor` matter) and always goes through the governed fetch layer with
// `delegatedFor` set; there is no call without it, so bulk or unscoped lookups cannot be made here.
// The fetch layer applies the source's tier cap, cost cap, kill switch and the per-source and
// per-advocate rate limits. The page is parsed in memory with the shared status parsers and only
// the parsed fields, their hash and the provenance of the lookup (tier used, cost, server) are
// stored; an unchanged page writes no second snapshot. A changed next date is staged as a proposal.
import { createHash } from 'node:crypto';

import {
  parseCaseStatus,
  type CaseStatusTemplate,
  type ParsedCaseStatus,
} from '@causedeck/adapters';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, desc, eq, ne } from 'drizzle-orm';

import { submitProposals } from '../automation/index.ts';
import {
  getCanonicalNextDate,
  type GraphActor,
  type MatterGraphDeps,
} from '../matter-graph/index.ts';
import { invalid, notFound } from '../shared/errors.ts';
import { policyFor } from '../sources/index.ts';

import { diffStatus, statusChangeDraft, type StatusChanges } from './diff.ts';

const { caseWatch, caseStatusSnapshot, proceeding } = schema;

type Db = Database | Transaction;

/** Where a status source's search lives under its `base_url`, and the template that reads the result. */
export interface StatusSource {
  template: CaseStatusTemplate;
  path: string;
}

/** The status sources a watch can read (their rows are seeded uncleared, counsel clears them). */
export const STATUS_SOURCES: Readonly<Record<string, StatusSource>> = {
  'in.tn.chennai-district:case_status': { template: 'ecourts-district', path: 'case-status' },
  // National district courts (#636): one eCourts template, a source per state.
  'in.tn.district:case_status': { template: 'ecourts-district', path: 'case-status' },
  'in.ka.district:case_status': { template: 'ecourts-district', path: 'case-status' },
  'in.mh.district:case_status': { template: 'ecourts-district', path: 'case-status' },
  'in.dl.district:case_status': { template: 'ecourts-district', path: 'case-status' },
  'in.up.district:case_status': { template: 'ecourts-district', path: 'case-status' },
  'in.tn.madras-hc.chennai:case_status': { template: 'madras-hc', path: 'case-status' },
  'in.ka.karnataka-hc.bengaluru:case_status': { template: 'karnataka-hc', path: 'case-status' },
};

/** Structurally the `Fetcher` of `@causedeck/fetch`, which this module does not import for types. */
export interface StatusFetcher {
  fetchSource(
    sourceId: string,
    url: string,
    opts: { delegatedFor: { advocateId: string; matterId: string } },
  ): Promise<{
    body: string;
    provenance: {
      url: string;
      fetchedAt: string;
      sha256: string;
      tierUsed: schema.SourceMaxTier;
      costDollars: number;
    };
  }>;
}

export interface CaseStatusLookupDeps {
  db: Db;
  fetcher: StatusFetcher;
  /** The source's base URL; throws `SourceNotCleared` when it may not be fetched. Defaults to the registry. */
  policy?: (sourceId: string) => Promise<{ baseUrl: string }>;
  sources?: Readonly<Record<string, StatusSource>>;
  events?: MatterGraphDeps['events'];
  now?: () => Date;
}

export type CaseStatusLookupOutcome = 'changed' | 'unchanged' | 'not_found' | 'unrecognised';

export interface CaseStatusLookupReport {
  outcome: CaseStatusLookupOutcome;
  snapshotId: string | null;
  changes: StatusChanges | null;
  /** Proposals staged for the changes. */
  proposals: number;
  /** True when the stored snapshot is the watch's first, so every field counts as new (no alert). */
  firstSnapshot: boolean;
  /** The matter of the watched proceeding. */
  matterId: string | null;
}

const NO_EVENTS: MatterGraphDeps['events'] = {
  emit() {
    // Staging a proposal has no event subscribers.
  },
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
};

/** sha256 hex of the canonical (key-sorted) JSON of `fields`. */
export const hashStatusFields = (fields: ParsedCaseStatus): string =>
  createHash('sha256').update(canonical(fields)).digest('hex');

interface WatchContext {
  watch: typeof caseWatch.$inferSelect;
  matterId: string;
}

/** The actor's own watch and the matter of its proceeding; anyone else's id is not found. */
async function loadWatch(db: Db, actor: GraphActor, watchId: string): Promise<WatchContext> {
  // The actor must still be able to read the matter (NOT_FOUND otherwise).
  const row = await withWorkspace(db, actor, async (tx) => {
    const [found] = await tx
      .select({ watch: caseWatch, matterId: proceeding.matterId })
      .from(caseWatch)
      .innerJoin(
        proceeding,
        and(
          eq(proceeding.workspaceId, caseWatch.workspaceId),
          eq(proceeding.id, caseWatch.proceedingId),
        ),
      )
      .where(
        and(
          eq(caseWatch.workspaceId, actor.workspaceId),
          eq(caseWatch.advocateUserId, actor.userId),
          eq(caseWatch.id, watchId),
        ),
      );
    return found;
  });
  if (row === undefined) throw notFound('Watch not found');
  await getCanonicalNextDate({ db, events: NO_EVENTS }, actor, {
    proceedingId: row.watch.proceedingId,
  });
  return { watch: row.watch, matterId: row.matterId };
}

function lookupUrl(baseUrl: string, source: StatusSource, watch: WatchContext['watch']): string {
  const url = new URL(source.path, baseUrl);
  if (watch.cnr !== null) url.searchParams.set('cnr', watch.cnr);
  else if (watch.caseNumber !== null) url.searchParams.set('case_number', watch.caseNumber);
  return url.toString();
}

interface StoreInput {
  watch: WatchContext['watch'];
  matterId: string;
  parsed: ParsedCaseStatus;
  via: schema.CaseStatusVia;
  tierUsed: schema.SourceMaxTier | null;
  costDollars: number;
  fetchedAt: Date;
  sourceRef: string;
}

/** Store a parsed status as a snapshot unless the watch already holds the same content, then stage proposals. */
async function storeAndDiff(
  deps: { db: Db; events?: MatterGraphDeps['events']; now?: () => Date },
  actor: GraphActor,
  input: StoreInput,
): Promise<CaseStatusLookupReport> {
  const { watch, parsed } = input;
  const contentHash = hashStatusFields(parsed);
  const stored = await withWorkspace(deps.db, actor, async (tx) => {
    const [inserted] = await tx
      .insert(caseStatusSnapshot)
      .values({
        workspaceId: actor.workspaceId,
        watchId: watch.id,
        fields: parsed,
        contentHash,
        via: input.via,
        tierUsed: input.tierUsed,
        costDollars: String(input.costDollars),
        fetchedAt: input.fetchedAt,
        sourceType: 'adapter',
        sourceRef: input.sourceRef,
        confirmationState: 'proposed',
      })
      .onConflictDoNothing()
      .returning({ id: caseStatusSnapshot.id });
    await tx
      .update(caseWatch)
      .set({ lastPolledAt: input.fetchedAt })
      .where(and(eq(caseWatch.workspaceId, actor.workspaceId), eq(caseWatch.id, watch.id)));
    if (inserted === undefined) return null;
    const [previous] = await tx
      .select({ fields: caseStatusSnapshot.fields })
      .from(caseStatusSnapshot)
      .where(
        and(
          eq(caseStatusSnapshot.workspaceId, actor.workspaceId),
          eq(caseStatusSnapshot.watchId, watch.id),
          ne(caseStatusSnapshot.id, inserted.id),
        ),
      )
      .orderBy(desc(caseStatusSnapshot.fetchedAt), desc(caseStatusSnapshot.createdAt))
      .limit(1);
    return { id: inserted.id, previous: previous ? (previous.fields as ParsedCaseStatus) : null };
  });
  if (stored === null)
    return {
      outcome: 'unchanged',
      snapshotId: null,
      changes: null,
      proposals: 0,
      firstSnapshot: false,
      matterId: input.matterId,
    };

  const changes = diffStatus(stored.previous, parsed);
  const draft = statusChangeDraft(
    {
      proceedingId: watch.proceedingId,
      matterId: input.matterId,
      watchId: watch.id,
      snapshotId: stored.id,
    },
    changes,
    parsed,
  );
  if (draft !== null) {
    await submitProposals(
      { db: deps.db, events: deps.events ?? NO_EVENTS, ...(deps.now ? { now: deps.now } : {}) },
      actor,
      [draft],
    );
  }
  return {
    outcome: 'changed',
    snapshotId: stored.id,
    changes,
    proposals: draft === null ? 0 : 1,
    firstSnapshot: stored.previous === null,
    matterId: input.matterId,
  };
}

/**
 * Look up the status of the actor's own watch through the fetch layer, delegated for the actor and
 * the proceeding's matter. Another advocate's watch is NOT_FOUND, an unknown status source is
 * VALIDATION and an uncleared source throws `SourceNotCleared`; none of them fetches.
 */
export async function runCaseStatusLookup(
  deps: CaseStatusLookupDeps,
  actor: GraphActor,
  input: { watchId: string },
): Promise<CaseStatusLookupReport> {
  const ctx = await loadWatch(deps.db, actor, input.watchId);
  const { watch } = ctx;
  const source = (deps.sources ?? STATUS_SOURCES)[watch.sourceId];
  if (source === undefined) throw invalid('This source has no status lookup');
  const policy = deps.policy ?? ((id: string) => policyFor(id, { db: deps.db }));
  const { baseUrl } = await policy(watch.sourceId);
  const fetched = await deps.fetcher.fetchSource(
    watch.sourceId,
    lookupUrl(baseUrl, source, watch),
    {
      delegatedFor: { advocateId: actor.userId, matterId: ctx.matterId },
    },
  );
  const parsed = parseCaseStatus(source.template, fetched.body);
  // `fetched.body` goes out of scope here: only the parsed fields are stored.
  if (parsed.status !== 'ok') {
    return {
      outcome: parsed.status,
      snapshotId: null,
      changes: null,
      proposals: 0,
      firstSnapshot: false,
      matterId: ctx.matterId,
    };
  }
  return storeAndDiff(deps, actor, {
    watch,
    matterId: ctx.matterId,
    parsed,
    via: 'server',
    tierUsed: fetched.provenance.tierUsed,
    costDollars: fetched.provenance.costDollars,
    fetchedAt: new Date(fetched.provenance.fetchedAt),
    sourceRef: fetched.provenance.url,
  });
}

/** Store a status the advocate's device read (on-device captcha solve, no server tier or cost) and diff it. */
export async function recordDeviceSnapshot(
  deps: { db: Db; events?: MatterGraphDeps['events']; now?: () => Date },
  actor: GraphActor,
  input: { watchId: string; status: ParsedCaseStatus },
): Promise<CaseStatusLookupReport> {
  const ctx = await loadWatch(deps.db, actor, input.watchId);
  if (input.status.status !== 'ok') {
    return {
      outcome: input.status.status,
      snapshotId: null,
      changes: null,
      proposals: 0,
      firstSnapshot: false,
      matterId: ctx.matterId,
    };
  }
  return storeAndDiff(deps, actor, {
    watch: ctx.watch,
    matterId: ctx.matterId,
    parsed: input.status,
    via: 'device',
    tierUsed: null,
    costDollars: 0,
    fetchedAt: (deps.now ?? (() => new Date()))(),
    sourceRef: 'device',
  });
}

/** Mark the actor's own watch as polled at `at` (a lookup that stored nothing still honours the cadence). */
export async function touchWatchPolled(
  db: Db,
  actor: GraphActor,
  watchId: string,
  at: Date,
): Promise<void> {
  await withWorkspace(db, actor, async (tx) => {
    await tx
      .update(caseWatch)
      .set({ lastPolledAt: at })
      .where(
        and(
          eq(caseWatch.workspaceId, actor.workspaceId),
          eq(caseWatch.advocateUserId, actor.userId),
          eq(caseWatch.id, watchId),
        ),
      );
  });
}
