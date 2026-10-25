// Karnataka HC cause-list watches (#482, D-048 tier 2, D-028 A2). A member watches an advocate name
// or BRN on a public list source; `pollCauseList` fetches each list publication once through the
// governed fetch layer, however many workspaces watch it (`cause_list_publication` is global and
// content-free: URL, fetch time, sha256, row count), parses it in memory with the KHC adapter and,
// per watching member, keeps only the rows that carry their identifier (matched-only rule, docs/
// product/09 §8.4: other advocates' rows are counted, never stored or logged). Matches are staged
// as L2 `new_proceeding` proposals with a score-only match, so the engine never applies them
// unasked; the proposal's source ref names the publication for the "Fetched from the KHC public
// list" chip. Nothing is fetched while the flag `court.khc-a2` is off or the source is uncleared.
// Watches are read across workspaces only through `app_cause_list_watch_targets` (0068). Counts only
// are logged.
import {
  createKarnatakaHcAdapter,
  extractBarRegistrationNo,
  extractEnrolmentNo,
  KARNATAKA_HC_FORUM_CODES,
  type ParsedCauseList,
} from '@causedeck/adapters';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { isEnabled } from '@causedeck/flags';
import { and, asc, eq, sql } from 'drizzle-orm';

import { submitProposals } from '../automation/index.ts';
import type { GraphActor, MatterGraphDeps } from '../matter-graph/index.ts';
import { filterMatchedRows, getAdvocateIdentifiers, listRowPayloads } from '../import/index.ts';
import { invalid, notFound } from '../shared/errors.ts';
import { policyFor, SourceNotCleared } from '../sources/index.ts';

const { causeListPublication, causeListWatch } = schema;

/** The source row of the KHC public list (seeded uncleared by 0067). */
export const KHC_CAUSE_LIST_SOURCE_ID = 'in.ka.karnataka-hc.bengaluru:cause_list';
export const COURT_KHC_A2_FLAG = 'court.khc-a2';
/** The list pages under the source's `base_url`, by list type. */
export const KHC_LIST_PATHS = { daily: 'causelist/daily', advance: 'causelist/advance' } as const;
export type KhcListType = keyof typeof KHC_LIST_PATHS;
/** The `source.ref` prefix of a proposal staged from a publication. */
export const PUBLICATION_REF_PREFIX = 'cause_list_publication:';
const MAX_WATCHES_PER_MEMBER = 20;

export interface CauseListWatchRow {
  id: string;
  sourceId: string;
  kind: schema.CauseListWatchKind;
  value: string;
}

type Db = Database | Transaction;

/** The watch value as stored: a BRN upper-cased in its printed form, a name trimmed as written. */
function normalizeWatch(kind: schema.CauseListWatchKind, raw: string): string {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value === '' || value.length > 200)
    throw invalid('Enter a name or BRN of up to 200 characters');
  if (kind === 'brn') {
    // Only a printed enrolment number or BRN: the identifier helper would accept any text.
    const key = extractEnrolmentNo(value) ?? extractBarRegistrationNo(value);
    if (key === null) throw invalid('Enter a valid BRN');
    return key;
  }
  if (getAdvocateIdentifiers({ aliases: [value] }).aliases.length === 0) {
    throw invalid('Enter an advocate name');
  }
  return value;
}

/** Watch `value` on the list source for the member. Adding the same watch again changes nothing. */
export async function addCauseListWatch(
  deps: { db: Db },
  actor: GraphActor,
  input: { kind: schema.CauseListWatchKind; value: string; sourceId?: string },
): Promise<CauseListWatchRow> {
  if (!schema.CAUSE_LIST_WATCH_KINDS.includes(input.kind)) throw invalid('Unknown watch kind');
  const sourceId = input.sourceId ?? KHC_CAUSE_LIST_SOURCE_ID;
  const value = normalizeWatch(input.kind, input.value);
  return withWorkspace(deps.db, actor, async (tx) => {
    const mine = and(
      eq(causeListWatch.workspaceId, actor.workspaceId),
      eq(causeListWatch.userId, actor.userId),
    );
    const held = await tx.select({ id: causeListWatch.id }).from(causeListWatch).where(mine);
    if (held.length >= MAX_WATCHES_PER_MEMBER) throw invalid('Too many watches');
    await tx
      .insert(causeListWatch)
      .values({
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        sourceId,
        kind: input.kind,
        value,
      })
      .onConflictDoNothing();
    const [row] = await tx
      .select({
        id: causeListWatch.id,
        sourceId: causeListWatch.sourceId,
        kind: causeListWatch.kind,
        value: causeListWatch.value,
      })
      .from(causeListWatch)
      .where(
        and(
          mine,
          eq(causeListWatch.sourceId, sourceId),
          eq(causeListWatch.kind, input.kind),
          eq(causeListWatch.value, value),
        ),
      );
    if (row === undefined) throw new Error('cause list watch insert returned no row');
    return row;
  });
}

/** The member's own watches. */
export async function listCauseListWatches(
  deps: { db: Db },
  actor: GraphActor,
): Promise<CauseListWatchRow[]> {
  return withWorkspace(deps.db, actor, (tx) =>
    tx
      .select({
        id: causeListWatch.id,
        sourceId: causeListWatch.sourceId,
        kind: causeListWatch.kind,
        value: causeListWatch.value,
      })
      .from(causeListWatch)
      .where(
        and(
          eq(causeListWatch.workspaceId, actor.workspaceId),
          eq(causeListWatch.userId, actor.userId),
        ),
      )
      .orderBy(asc(causeListWatch.createdAt), asc(causeListWatch.id)),
  );
}

/** Remove one of the member's own watches; another workspace's or member's id is not found. */
export async function removeCauseListWatch(
  deps: { db: Db },
  actor: GraphActor,
  watchId: string,
): Promise<void> {
  const removed = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .delete(causeListWatch)
      .where(
        and(
          eq(causeListWatch.workspaceId, actor.workspaceId),
          eq(causeListWatch.userId, actor.userId),
          eq(causeListWatch.id, watchId),
        ),
      )
      .returning({ id: causeListWatch.id }),
  );
  if (removed.length === 0) throw notFound('Watch not found');
}

/** The publication a proposal's source ref names, for the source chip; null when it is not one. */
export async function getPublicationForRef(
  deps: { db: Db },
  ref: string | null | undefined,
): Promise<{ id: string; url: string; fetchedAt: Date } | null> {
  if (ref === null || ref === undefined || !ref.startsWith(PUBLICATION_REF_PREFIX)) return null;
  const id = ref.slice(PUBLICATION_REF_PREFIX.length);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await deps.db
    .select({
      id: causeListPublication.id,
      url: causeListPublication.url,
      fetchedAt: causeListPublication.fetchedAt,
    })
    .from(causeListPublication)
    .where(eq(causeListPublication.id, id));
  return row ?? null;
}

// --- the poll ----------------------------------------------------------------------------------

/** Structurally the `Fetcher` of `@causedeck/fetch`, which this module does not import. */
export interface ListFetcher {
  fetchSource(
    sourceId: string,
    url: string,
  ): Promise<{
    body: string;
    provenance: { url: string; fetchedAt: string; sha256: string };
  }>;
}

export type ListHtmlParser = (html: string, receivedAt: string) => Promise<ParsedCauseList>;

/** The KHC adapter over fetched HTML. */
export function createKhcListParser(): ListHtmlParser {
  const adapter = createKarnatakaHcAdapter();
  return (html, receivedAt) =>
    adapter.parseCauseList({
      kind: 'html',
      html,
      meta: { receivedAt, forumCode: KARNATAKA_HC_FORUM_CODES[0] },
    });
}

export interface PollCauseListDeps {
  db: Db;
  fetcher: ListFetcher;
  /** Defaults to the KHC adapter. */
  parser?: ListHtmlParser;
  clock?: { now(): Date };
  /** Whether the flag is on for the workspace; defaults to the flag service. */
  flagEnabled?: (workspaceId: string) => Promise<boolean>;
  /** The source's policy; throws `SourceNotCleared` when it may not be fetched. Defaults to the registry. */
  policy?: (sourceId: string) => Promise<{ baseUrl: string }>;
  /** Counts only: never row content. */
  log?: (event: string, counts: Record<string, number>) => void;
  /** The cause-list source to poll; defaults to the Karnataka HC list. */
  sourceId?: string;
  /**
   * Called once per workspace with the count of rows a publication matched for its members' watches
   * (never the rows); errors are swallowed. The job wires webhooks here (#626).
   */
  onMatch?: (match: CauseListMatchEvent) => Promise<unknown>;
}

export interface CauseListMatchEvent {
  workspaceId: string;
  sourceId: string;
  publicationId: string;
  matchCount: number;
}

export interface PollCauseListReport {
  outcome: 'ok' | 'source_not_cleared' | 'no_watchers' | 'flag_off';
  /** Provider calls made. */
  fetched: number;
  /** Publications already matched, skipped. */
  unchanged: number;
  /** Proposals staged. */
  proposals: number;
}

interface WatchTarget {
  workspaceId: string;
  userId: string;
  kind: schema.CauseListWatchKind;
  value: string;
}

const NO_EVENTS: MatterGraphDeps['events'] = {
  emit() {
    // Staging a proposal has no event subscribers.
  },
};

const istDate = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);

/** Fetch each list once, match it per watching member and stage proposals. Never throws for a closed gate. */
export async function pollCauseList(deps: PollCauseListDeps): Promise<PollCauseListReport> {
  const now = deps.clock?.now() ?? new Date();
  const log = deps.log ?? (() => undefined);
  const report: PollCauseListReport = { outcome: 'ok', fetched: 0, unchanged: 0, proposals: 0 };
  const policy = deps.policy ?? ((id: string) => policyFor(id, { db: deps.db }));
  const sourceId = deps.sourceId ?? KHC_CAUSE_LIST_SOURCE_ID;

  let baseUrl: string;
  try {
    baseUrl = (await policy(sourceId)).baseUrl;
  } catch (error) {
    if (error instanceof SourceNotCleared) return { ...report, outcome: 'source_not_cleared' };
    throw error;
  }

  const rows = await deps.db.execute<{
    workspace_id: string;
    user_id: string;
    kind: schema.CauseListWatchKind;
    value: string;
  }>(
    sql`select workspace_id::text, user_id::text, kind, value from app_cause_list_watch_targets(${sourceId})`,
  );
  if (rows.length === 0) return { ...report, outcome: 'no_watchers' };

  const flag = deps.flagEnabled ?? ((workspaceId) => isEnabled(COURT_KHC_A2_FLAG, { workspaceId }));
  const enabled = new Map<string, boolean>();
  const targets: WatchTarget[] = [];
  for (const row of rows) {
    let on = enabled.get(row.workspace_id);
    if (on === undefined) {
      on = await flag(row.workspace_id);
      enabled.set(row.workspace_id, on);
    }
    if (on) {
      targets.push({
        workspaceId: row.workspace_id,
        userId: row.user_id,
        kind: row.kind,
        value: row.value,
      });
    }
  }
  if (targets.length === 0) return { ...report, outcome: 'flag_off' };

  // One member's identifiers: their name and BRN watches.
  const members = new Map<string, { actor: GraphActor; names: string[]; brns: string[] }>();
  for (const t of targets) {
    const key = `${t.workspaceId}:${t.userId}`;
    const member = members.get(key) ?? {
      actor: { workspaceId: t.workspaceId, userId: t.userId },
      names: [],
      brns: [],
    };
    (t.kind === 'brn' ? member.brns : member.names).push(t.value);
    members.set(key, member);
  }

  const parse = deps.parser ?? createKhcListParser();
  for (const type of Object.keys(KHC_LIST_PATHS) as KhcListType[]) {
    const url = new URL(KHC_LIST_PATHS[type], baseUrl).toString();
    const fetched = await deps.fetcher.fetchSource(sourceId, url);
    report.fetched += 1;
    const { sha256 } = fetched.provenance;
    const fetchedAt = new Date(fetched.provenance.fetchedAt);

    const [inserted] = await deps.db
      .insert(causeListPublication)
      .values({
        sourceId: sourceId,
        listKey: `${type}:${istDate(now)}`,
        url: fetched.provenance.url,
        sha256,
        fetchedAt,
      })
      .onConflictDoNothing()
      .returning({ id: causeListPublication.id });
    const [existing] = inserted
      ? [{ id: inserted.id, completedAt: null as Date | null }]
      : await deps.db
          .select({ id: causeListPublication.id, completedAt: causeListPublication.completedAt })
          .from(causeListPublication)
          .where(
            and(
              eq(causeListPublication.sourceId, sourceId),
              eq(causeListPublication.sha256, sha256),
            ),
          );
    if (existing === undefined) throw new Error('cause list publication row is missing');
    if (existing.completedAt !== null) {
      report.unchanged += 1;
      continue;
    }

    const list = await parse(fetched.body, now.toISOString());
    // `fetched.body` goes out of scope here: only the metadata above is ever stored.
    let unmatched = 0;
    const matchedByWorkspace = new Map<string, number>();
    for (const { actor, names, brns } of members.values()) {
      const identifiers = getAdvocateIdentifiers({ enrolmentNumbers: brns, aliases: names });
      const { matched, unmatchedCount } = filterMatchedRows(list.rows, identifiers);
      unmatched += unmatchedCount;
      const drafts = matched.flatMap((row) =>
        listRowPayloads(list, row).map((payload) => ({
          kind: 'new_proceeding' as const,
          source: {
            type: 'deterministic' as const,
            input: 'list',
            ref: `${PUBLICATION_REF_PREFIX}${existing.id}`,
          },
          payload,
          anchors: [],
          confidence: row.confidence,
          // A score only: an exact match would let the engine apply the draft unasked.
          match: { score: row.confidence },
          patternKey: 'khc:list_row',
        })),
      );
      if (drafts.length === 0) continue;
      await submitProposals({ db: deps.db, events: NO_EVENTS, now: () => now }, actor, drafts);
      report.proposals += drafts.length;
      matchedByWorkspace.set(
        actor.workspaceId,
        (matchedByWorkspace.get(actor.workspaceId) ?? 0) + drafts.length,
      );
    }
    await deps.db
      .update(causeListPublication)
      .set({ rowCount: list.rows.length, completedAt: now })
      .where(eq(causeListPublication.id, existing.id));
    for (const [workspaceId, matchCount] of matchedByWorkspace) {
      try {
        await deps.onMatch?.({ workspaceId, sourceId, publicationId: existing.id, matchCount });
      } catch {
        // An event that cannot be emitted never fails the poll.
      }
    }
    log('causelist.publication_matched', {
      rows: list.rows.length,
      unmatched,
      members: members.size,
    });
  }
  log('causelist.poll', {
    fetched: report.fetched,
    unchanged: report.unchanged,
    proposals: report.proposals,
  });
  return report;
}
