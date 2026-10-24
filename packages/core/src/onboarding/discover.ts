// Zero-entry onboarding discovery (#501, D-048): from an advocate's identifiers and courts, run the
// delegated advocate searches through the governed fetch layer (30 to 90 days back plus the
// upcoming lists), parse each result in memory, keep only the rows that carry the advocate
// (matched-only rule, docs/product/09 §8.4) and stage them as proposals on an import batch, so the
// existing plan and confirm grid take over. Nothing reaches the matter graph here: the staged
// proposals, the batch and its plan are applied only by `applyImportPlan` after the confirm grid.
// A name alone never decides: a name-only identity returns sample matters to confirm, and a row
// that carries a different enrolment number is left out and reported, never merged. A source that
// is uncleared or killed is skipped (`policyFor` fails closed); a failing court never fails the run.
// Counts only are logged, never row content.
import {
  createKarnatakaHcAdapter,
  createMadrasHcAdapter,
  KARNATAKA_HC_FORUM_CODES,
  MADRAS_HC_FORUM_CODES,
  parseEcourtsCauseList,
  type ParsedCauseList,
  type ParsedListRow,
} from '@causedeck/adapters';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, count, eq } from 'drizzle-orm';

import { submitProposals } from '../automation/index.ts';
import {
  buildImportPlan,
  createAdvocateMatcher,
  createImportBatch,
  filterMatchedRows,
  getAdvocateIdentifiers,
  hasIdentifiers,
  istDay,
  listRowPayloads,
  type AdvocateIdentifiers,
} from '../import/index.ts';
import type { GraphActor, MatterGraphDeps } from '../matter-graph/index.ts';
import { invalid } from '../shared/errors.ts';
import { policyFor, SourceNotCleared } from '../sources/index.ts';

type Db = Database | Transaction;

export const MIN_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 90;
export const DEFAULT_WINDOW_DAYS = 60;
/** How far ahead the upcoming lists are searched. */
export const UPCOMING_DAYS = 30;
const MAX_SAMPLES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SearchQuery {
  names: string[];
  enrolmentNumbers: string[];
  /** `YYYY-MM-DD`, IST. */
  from: string;
  to: string;
}

/** One court's advocate search: where to ask and how to read the answer. */
export interface DiscoverySource {
  sourceId: string;
  /** The forum a listing found here belongs to, for the progress view. */
  courtCode: string;
  searchUrl(baseUrl: string, query: SearchQuery): string;
  parse(body: string, receivedAt: string): Promise<ParsedCauseList>;
}

/** Structurally the `Fetcher` of `@causedeck/fetch`, which this module does not import. */
export interface DiscoveryFetcher {
  fetchSource(
    sourceId: string,
    url: string,
    options: { delegatedFor: { advocateId: string; matterId: string } },
  ): Promise<{
    body: string;
    provenance: { url: string; fetchedAt: string; sha256: string; tierUsed?: string };
  }>;
}

export interface DiscoverDeps {
  db: Db;
  fetcher: DiscoveryFetcher;
  /** Defaults to the launch courts (`DISCOVERY_SOURCES`). */
  sources?: Readonly<Record<string, DiscoverySource>>;
  clock?: { now(): Date };
  /** The source's policy; throws `SourceNotCleared` when it may not be fetched. Defaults to the registry. */
  policy?: (sourceId: string) => Promise<{ baseUrl: string }>;
  /** Counts only: never row content. */
  log?: (event: string, counts: Record<string, number>) => void;
}

export interface DiscoverInput {
  /** The courts to search: keys of the sources map. */
  sourceIds: readonly string[];
  enrolmentNumbers?: readonly string[];
  /** Name spellings as the advocate writes them. */
  names?: readonly string[];
  /** Days back, clamped to 30..90. */
  windowDays?: number;
  /** A batch started by an earlier call of the same discovery; a new one is created otherwise. */
  batchId?: string;
  /** For a name-only identity: the sample matters (`matchKey`) the advocate says are theirs. */
  confirmedMatchKeys?: readonly string[];
}

export interface DiscoverySample {
  sourceId: string;
  matchKey: string;
  label: string | null;
  parties: string | null;
  /** The enrolment number printed for the matching advocate, if any. */
  enrolmentNo: string | null;
}

export type CourtOutcome = 'searched' | 'not_cleared' | 'failed';

export interface CourtResult {
  sourceId: string;
  courtCode: string;
  outcome: CourtOutcome;
  /** Listings that carry the advocate (staged, or offered as samples). */
  listings: number;
}

export interface DiscoveryCounts {
  /** Matched listings, across courts. */
  listings: number;
  /** Courts that returned at least one. */
  courts: number;
  /** Rows that name another advocate with the same name: left out. */
  ambiguousExcluded: number;
  /** Rows that did not carry the advocate: counted, never stored. */
  unmatched: number;
}

export type DiscoveryOutcome =
  | {
      status: 'needs_disambiguation';
      reason: 'name_only';
      /** Distinct enrolment numbers printed beside the name, to confirm one. */
      candidateEnrolments: string[];
      samples: DiscoverySample[];
      courts: CourtResult[];
      counts: DiscoveryCounts;
    }
  | { status: 'nothing_found'; courts: CourtResult[]; counts: DiscoveryCounts }
  | {
      status: 'staged';
      batchId: string;
      courts: CourtResult[];
      counts: DiscoveryCounts;
      /** Same-name rows with another enrolment number, offered for review, never staged. */
      ambiguous: DiscoverySample[];
    };

const NO_EVENTS: MatterGraphDeps['events'] = {
  emit() {
    // Staging a proposal has no event subscribers.
  },
};

const fold = (value: string): string => value.trim().replace(/\s+/g, ' ');

function searchUrlFor(path: string) {
  return (baseUrl: string, query: SearchQuery): string => {
    const url = new URL(path, baseUrl);
    for (const name of query.names) url.searchParams.append('name', name);
    for (const enrolment of query.enrolmentNumbers) url.searchParams.append('enrolment', enrolment);
    url.searchParams.set('from', query.from);
    url.searchParams.set('to', query.to);
    return url.toString();
  };
}

/** The launch courts. Each source row is seeded uncleared (migration 20261024200000). */
export const DISCOVERY_SOURCES: Readonly<Record<string, DiscoverySource>> = (() => {
  const khc = createKarnatakaHcAdapter();
  const mhc = createMadrasHcAdapter();
  const sources: DiscoverySource[] = [
    {
      sourceId: 'in.ka.karnataka-hc.bengaluru:advocate_search',
      courtCode: KARNATAKA_HC_FORUM_CODES[0],
      searchUrl: searchUrlFor('causelist/advocate'),
      parse: (html, receivedAt) =>
        khc.parseCauseList({
          kind: 'html',
          html,
          meta: { receivedAt, forumCode: KARNATAKA_HC_FORUM_CODES[0] },
        }),
    },
    {
      sourceId: 'in.tn.madras-hc.chennai:advocate_search',
      courtCode: MADRAS_HC_FORUM_CODES[0],
      searchUrl: searchUrlFor('advocate-search'),
      parse: (html, receivedAt) =>
        mhc.parseCauseList({
          kind: 'html',
          html,
          meta: { receivedAt, forumCode: MADRAS_HC_FORUM_CODES[0] },
        }),
    },
    {
      sourceId: 'in.tn.district:advocate_search',
      courtCode: 'in.tn.district',
      searchUrl: searchUrlFor('advocate-search'),
      parse: (html) => Promise.resolve(parseEcourtsCauseList(html, { forumCode: 'in.tn.district' })),
    },
  ];
  return Object.fromEntries(sources.map((source) => [source.sourceId, source]));
})();

/** The inclusive IST date window: `windowDays` back (30 to 90) to `UPCOMING_DAYS` ahead. */
export function discoveryWindow(now: Date, windowDays?: number): { from: string; to: string } {
  const days = Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, windowDays ?? DEFAULT_WINDOW_DAYS));
  return {
    from: istDay(new Date(now.getTime() - days * DAY_MS)),
    to: istDay(new Date(now.getTime() + UPCOMING_DAYS * DAY_MS)),
  };
}

type Evidence = 'enrolment' | 'name' | 'conflict';

/**
 * How a matched row carries the advocate: by an enrolment number of theirs, by name alone, or by a
 * same-name advocate printed with a different enrolment number (not them).
 */
function evidenceOf(row: ParsedListRow, identifiers: AdvocateIdentifiers): Evidence {
  const advocates = row.advocates ?? [];
  const byEnrolment = createAdvocateMatcher({
    enrolmentNumbers: identifiers.enrolmentNumbers,
    aliases: [],
  });
  if (advocates.some(byEnrolment)) return 'enrolment';
  const byName = createAdvocateMatcher({ enrolmentNumbers: [], aliases: identifiers.aliases });
  const named = advocates.filter(byName);
  if (identifiers.enrolmentNumbers.length > 0 && named.some((a) => (a.enrolmentNo ?? '') !== '')) {
    return 'conflict';
  }
  return 'name';
}

const sampleOf = (sourceId: string, row: ParsedListRow, identifiers: AdvocateIdentifiers) => {
  const byName = createAdvocateMatcher({ enrolmentNumbers: [], aliases: identifiers.aliases });
  const printed = (row.advocates ?? []).find(byName)?.enrolmentNo ?? null;
  return {
    sourceId,
    matchKey: row.matchKey ?? '',
    label: row.caseNumber === null ? null : fold(`${row.caseTypeRaw} ${row.caseNumber}`),
    parties: row.parties === undefined ? null : fold(row.parties),
    enrolmentNo: printed === null || printed === '' ? null : printed,
  } satisfies DiscoverySample;
};

interface CourtFetch {
  source: DiscoverySource;
  result: CourtResult;
  list: ParsedCauseList | null;
  provenance: { url: string; fetchedAt: string; sha256: string; tierUsed?: string } | null;
}

async function searchCourt(
  deps: DiscoverDeps,
  actor: GraphActor,
  source: DiscoverySource,
  query: SearchQuery,
  matterRef: string,
  now: Date,
): Promise<CourtFetch> {
  const base = { source, list: null, provenance: null };
  const result = (outcome: CourtOutcome): CourtResult => ({
    sourceId: source.sourceId,
    courtCode: source.courtCode,
    outcome,
    listings: 0,
  });
  const policy = deps.policy ?? ((id: string) => policyFor(id, { db: deps.db }));
  let baseUrl: string;
  try {
    baseUrl = (await policy(source.sourceId)).baseUrl;
  } catch (error) {
    if (error instanceof SourceNotCleared) return { ...base, result: result('not_cleared') };
    throw error;
  }
  try {
    const fetched = await deps.fetcher.fetchSource(
      source.sourceId,
      source.searchUrl(baseUrl, query),
      { delegatedFor: { advocateId: actor.userId, matterId: matterRef } },
    );
    // `fetched.body` goes out of scope with this function: only the matched rows are staged.
    const list = await source.parse(fetched.body, now.toISOString());
    return { source, result: result('searched'), list, provenance: fetched.provenance };
  } catch {
    // A court that cannot be read (rate limit, block, parse) never fails the discovery.
    return { ...base, result: result('failed') };
  }
}

interface Staged {
  fetch: CourtFetch;
  rows: ParsedListRow[];
}

async function stage(
  deps: DiscoverDeps,
  actor: GraphActor,
  batchId: string,
  staged: Staged[],
  now: Date,
): Promise<void> {
  const { capture, importBatch, importBatchFile } = schema;
  await withWorkspace(deps.db, actor, async (tx) => {
    for (const { fetch, rows } of staged) {
      const { list, provenance, source } = fetch;
      if (list === null || provenance === null) continue;
      const [cap] = await tx
        .insert(capture)
        .values({
          workspaceId: actor.workspaceId,
          channel: 'bulk_import',
          status: 'ready',
          mime: 'application/json',
          sizeBytes: 0,
          originalFilename: `${source.sourceId}.json`,
          sha256: provenance.sha256,
          scanStatus: 'skipped',
          createdBy: actor.userId,
          sourceMeta: {
            discovery: {
              sourceId: source.sourceId,
              url: provenance.url,
              fetchedAt: provenance.fetchedAt,
              sha256: provenance.sha256,
              ...(provenance.tierUsed === undefined ? {} : { tierUsed: provenance.tierUsed }),
            },
          },
        })
        .returning({ id: capture.id });
      if (cap === undefined) throw new Error('capture insert returned no row');
      const drafts = rows.flatMap((row) =>
        listRowPayloads(list, row).map((payload) => ({
          kind: 'new_proceeding' as const,
          captureId: cap.id,
          source: {
            type: 'deterministic' as const,
            input: 'list',
            ref: `discovery:${source.sourceId}:${provenance.sha256}`,
          },
          payload,
          anchors: [],
          confidence: row.confidence,
          // A score only: an exact match would let the engine apply the draft unasked.
          match: { score: row.confidence },
          patternKey: 'discovery:advocate_search',
        })),
      );
      if (drafts.length > 0) {
        await submitProposals({ db: tx, events: NO_EVENTS, now: () => now }, actor, drafts);
      }
      await tx.insert(importBatchFile).values({
        workspaceId: actor.workspaceId,
        batchId,
        captureId: cap.id,
        status: drafts.length > 0 ? 'parsed' : 'unmatched',
        adapterId: list.adapterId,
        rowsMatched: drafts.length,
      });
    }
    const [total] = await tx
      .select({ n: count() })
      .from(importBatchFile)
      .where(
        and(
          eq(importBatchFile.workspaceId, actor.workspaceId),
          eq(importBatchFile.batchId, batchId),
        ),
      );
    await tx
      .update(importBatch)
      .set({ fileCount: total?.n ?? 0 })
      .where(and(eq(importBatch.workspaceId, actor.workspaceId), eq(importBatch.id, batchId)));
  });
}

/**
 * Search the courts for the advocate and stage what carries them. Writes nothing (no batch, no
 * capture, no proposal) until the identity is settled: a name-only identity returns
 * `needs_disambiguation` with samples, and is staged only for the `confirmedMatchKeys` the advocate
 * picks. Staged proposals feed the existing plan: the matter graph changes only on its apply.
 */
export async function discoverAdvocateCases(
  deps: DiscoverDeps,
  actor: GraphActor,
  input: DiscoverInput,
): Promise<DiscoveryOutcome> {
  const identifiers = getAdvocateIdentifiers({
    enrolmentNumbers: [...(input.enrolmentNumbers ?? [])],
    aliases: [...(input.names ?? [])],
  });
  if (!hasIdentifiers(identifiers)) throw invalid('Enter an enrolment number or a name spelling');
  const registry = deps.sources ?? DISCOVERY_SOURCES;
  const sources = [...new Set(input.sourceIds)].map((id) => {
    const source = registry[id];
    if (source === undefined) throw invalid('This court has no advocate search');
    return source;
  });
  if (sources.length === 0) throw invalid('Choose at least one court');

  const now = deps.clock?.now() ?? new Date();
  const log = deps.log ?? (() => undefined);
  const query: SearchQuery = {
    names: [...(input.names ?? [])].map(fold).filter((name) => name !== ''),
    enrolmentNumbers: identifiers.enrolmentNumbers,
    ...discoveryWindow(now, input.windowDays),
  };
  const nameOnly = identifiers.enrolmentNumbers.length === 0;
  const confirmed = new Set(input.confirmedMatchKeys ?? []);

  const counts: DiscoveryCounts = { listings: 0, courts: 0, ambiguousExcluded: 0, unmatched: 0 };
  const courts: CourtResult[] = [];
  const staged: Staged[] = [];
  const samples: DiscoverySample[] = [];
  const ambiguous: DiscoverySample[] = [];
  const candidateEnrolments = new Set<string>();
  const matterRef = input.batchId ?? `onboarding:${actor.workspaceId}`;

  for (const source of sources) {
    const fetch = await searchCourt(deps, actor, source, query, matterRef, now);
    const result = fetch.result;
    courts.push(result);
    if (fetch.list === null) continue;
    const { matched, unmatchedCount } = filterMatchedRows(fetch.list.rows, identifiers);
    counts.unmatched += unmatchedCount;
    const rows: ParsedListRow[] = [];
    for (const row of matched) {
      const evidence = evidenceOf(row, identifiers);
      const sample = sampleOf(source.sourceId, row, identifiers);
      if (evidence === 'conflict') {
        counts.ambiguousExcluded += 1;
        if (ambiguous.length < MAX_SAMPLES) ambiguous.push(sample);
        continue;
      }
      if (evidence === 'name' && nameOnly) {
        if (sample.enrolmentNo !== null) candidateEnrolments.add(sample.enrolmentNo);
        if (samples.length < MAX_SAMPLES) samples.push(sample);
        // Only the sample matters the advocate confirms are staged.
        if (row.matchKey === null || !confirmed.has(row.matchKey)) {
          result.listings += 1;
          continue;
        }
      }
      rows.push(row);
    }
    result.listings += rows.length;
    counts.listings += result.listings;
    if (result.listings > 0) counts.courts += 1;
    if (rows.length > 0) staged.push({ fetch, rows });
  }

  log('onboarding.discovery', { ...counts, searched: courts.length });
  if (nameOnly && staged.length === 0 && counts.listings > 0) {
    return {
      status: 'needs_disambiguation',
      reason: 'name_only',
      candidateEnrolments: [...candidateEnrolments].sort(),
      samples,
      courts,
      counts,
    };
  }
  if (staged.length === 0) return { status: 'nothing_found', courts, counts };

  const batchId = input.batchId ?? (await createImportBatch({ db: deps.db }, actor)).batchId;
  await stage(deps, actor, batchId, staged, now);
  await buildImportPlan(
    { db: deps.db, now: () => now, log },
    { workspaceId: actor.workspaceId, batchId, identifiers },
  );
  await withWorkspace(deps.db, actor, (tx) =>
    tx
      .update(schema.importBatch)
      .set({ status: 'ready' })
      .where(
        and(
          eq(schema.importBatch.workspaceId, actor.workspaceId),
          eq(schema.importBatch.id, batchId),
        ),
      ),
  );
  return { status: 'staged', batchId, courts, counts, ambiguous };
}
