// Matter read models for the matters screens (#386, part 1 of #40): the list (`searchMatters`), the
// Overview, the proceedings tree, the people and the documents of a matter. They only read, emit no
// events and run in the actor's workspace scope like every graph service. The list filters with
// `matterVisibilityPredicate` (an actor without `matter.read` gets an empty page); a single matter
// goes through the same check as `requireMatter`, so another workspace's matter, or one the actor
// may not read, is NOT_FOUND.
//
// - A matter's next date is the earliest canonical listing dated today or later (Asia/Kolkata)
//   across its proceedings; its stage is that listing's stage. Parties and forum come from the lead
//   proceeding: the earliest top-level `main` proceeding, else the earliest proceeding.
// - A conflict is a `proposed`, non-canonical listing dated today or later whose date differs from
//   its proceeding's canonical date. It is shown with both sides and never resolved here
//   (next-date.ts makes a date canonical, through a person).
// - The synopsis is a note a member typed (`updateMatter` is its only writer), so its provenance is
//   `manual`; it is returned only to actors with `strategy.read` on the matter.
// - Search matches the title, the parties printed in a proceeding's title, the names and aliases
//   of the matter's people, and case numbers in any punctuation, normalised as duplicates.ts does.
import { can, type Actor, type PolicySettings, type Resource } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import {
  ROLE_EDGE_KINDS,
  type ConfirmationState,
  type DocumentKind,
  type DocumentTextStatus,
  type MatterStatus,
  type PersonContact,
  type PersonKind,
  type ProceedingKind,
  type ProceedingLinkKind,
  type ProceedingState,
  type RoleEdgeKind,
  type SourceType,
} from '@causedeck/db/schema';
import { schema, type Transaction } from '@causedeck/db';
import {
  ListMatterDocumentsInput,
  MatterReadInput,
  SearchMattersInput,
  type MatterSort,
  type ParsedSearchMatters,
} from '@causedeck/validators/matter-graph-inputs';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';

import { forbidden, invalid } from '../shared/errors.ts';

import {
  inGraphScope,
  matterResource,
  parseInput,
  type GraphActor,
  type GraphScope,
  type MatterGraphDeps,
  type MatterRow,
} from './context.ts';
import { expandYear, normaliseCaseNumber, normaliseCaseType } from './duplicates.ts';
import { graphNotFound } from './errors.ts';

const {
  document,
  forum,
  listing,
  matter,
  matterRestriction,
  member,
  obligation,
  person,
  proceeding,
  proceedingLink,
  roleEdge,
  user,
} = schema;

// ---------------------------------------------------------------------------------------------
// Row shapes.

export interface ForumSummary {
  id: string;
  court: string;
  establishment: string | null;
  seat: string | null;
}

export interface OwnerSummary {
  memberId: string;
  userId: string;
  name: string;
}

/** A canonical next date as the list shows it. */
export interface NextDateSummary {
  date: string;
  proceedingId: string;
  listingId: string;
  sourceType: SourceType;
  confirmationState: ConfirmationState;
}

/** One row of `searchMatters`. */
export interface MatterListRow {
  id: string;
  title: string;
  status: MatterStatus;
  sensitive: boolean;
  petitioner: string | null;
  respondent: string | null;
  forum: ForumSummary | null;
  /** The stage printed on the next-date listing (`stage_norm`, else `stage_raw`). */
  stage: string | null;
  proceedingCount: number;
  nextDate: NextDateSummary | null;
  owner: OwnerSummary | null;
  updatedAt: Date;
}

export interface MatterListPage {
  items: MatterListRow[];
  nextCursor: string | null;
}

/** Where a listing's date came from (MG-3: provenance everywhere). */
export interface ListingProvenance {
  sourceType: SourceType;
  sourceRef: string | null;
  anchorId: string | null;
  confidence: string | null;
  confirmationState: ConfirmationState;
  capturedAt: Date;
}

export interface ListingDetail extends NextDateSummary {
  stage: string | null;
  canonical: boolean;
  provenance: ListingProvenance;
}

/** A proposed date that differs from its proceeding's canonical date; both sides, unresolved. */
export interface NextDateConflictView {
  proceedingId: string;
  current: ListingDetail;
  proposed: ListingDetail;
}

export interface PersonView {
  id: string;
  name: string;
  aliases: string[];
  kind: PersonKind;
  /** Only for clients and professional contacts. */
  contact: PersonContact | null;
}

export interface RoleEdgeView {
  edgeId: string;
  /** Null for an edge to the matter itself. */
  proceedingId: string | null;
  person: PersonView;
  provenance: { sourceType: SourceType; confirmationState: ConfirmationState };
}

/** The matter's people by role edge kind, in `ROLE_EDGE_KINDS` order (empty groups included). */
export interface MatterPeopleGroup {
  kind: RoleEdgeKind;
  edges: RoleEdgeView[];
}

export type DocumentSource = { type: 'capture'; captureId: string } | { type: 'manual' };

export interface MatterDocumentRow {
  id: string;
  kind: DocumentKind;
  language: string | null;
  textStatus: DocumentTextStatus;
  source: DocumentSource;
  /** The version chain: the document this one replaces, and the one that replaced it. */
  supersedesDocumentId: string | null;
  supersededByDocumentId: string | null;
  createdAt: Date;
}

export interface MatterDocumentPage {
  items: MatterDocumentRow[];
  nextCursor: string | null;
}

export interface ProceedingLinkView {
  linkId: string;
  kind: ProceedingLinkKind;
  direction: 'from' | 'to';
  /** The proceeding at the other end of the link. */
  otherProceedingId: string;
  /** The other end's matter when it is another matter the actor may read, else null. */
  otherMatterId: string | null;
}

export interface ProceedingNode {
  id: string;
  kind: ProceedingKind;
  state: ProceedingState;
  /** As printed (`W.P.`), else the stored code. */
  caseType: string;
  caseTypeCode: string;
  number: string | null;
  year: number | null;
  srNo: string | null;
  frNo: string | null;
  diaryNo: string | null;
  filingNo: string | null;
  cnr: string | null;
  /** Not yet numbered (SR/FR stage). */
  unnumbered: boolean;
  petitioner: string | null;
  respondent: string | null;
  forum: ForumSummary;
  /** The canonical listing, if any. */
  nextDate: ListingDetail | null;
  links: ProceedingLinkView[];
  children: ProceedingNode[];
}

export interface MatterOverview {
  header: {
    id: string;
    title: string;
    status: MatterStatus;
    sensitive: boolean;
    practiceArea: string | null;
    openedAt: Date;
    updatedAt: Date;
    owner: OwnerSummary | null;
    clients: PersonView[];
  };
  nextDate: ListingDetail | null;
  conflicts: NextDateConflictView[];
  proceedings: {
    count: number;
    byState: Partial<Record<ProceedingState, number>>;
    lead: {
      id: string;
      caseType: string;
      number: string | null;
      year: number | null;
      forum: ForumSummary;
    } | null;
  };
  openObligations: number;
  /** The latest five documents; empty without `document.read`. */
  recentDocuments: MatterDocumentRow[];
  people: MatterPeopleGroup[];
  /** Null without `strategy.read` (then `synopsisDenied`) or when no synopsis was written. */
  synopsis: { text: string; provenance: { sourceType: 'manual' } } | null;
  synopsisDenied: boolean;
}

// ---------------------------------------------------------------------------------------------
// Shared helpers.

/** Court dates are Indian: Asia/Kolkata has a fixed +05:30 offset (as next-date.ts). */
const COURT_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function today(deps: MatterGraphDeps): string {
  return COURT_DAY.format((deps.now ?? (() => new Date()))());
}

const UUID = /^[0-9a-f-]{36}$/i;

function encodeCursor(parts: readonly string[]): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64url');
}

/** The cursor's string parts, or VALIDATION unless it has `size` strings and a uuid last. */
function decodeCursor(value: string, size: number): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalid('Invalid cursor');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== size ||
    !parsed.every((part): part is string => typeof part === 'string') ||
    !UUID.test(parsed[size - 1] ?? '')
  ) {
    throw invalid('Invalid cursor');
  }
  return parsed;
}

/** `%value%` for ILIKE with the wildcards in `value` escaped. */
function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The matter with its restriction and owner as a policy resource; NOT_FOUND unless readable. */
async function readableMatter(
  scope: GraphScope,
  matterId: string,
): Promise<{ row: MatterRow; resource: Resource; owner: OwnerSummary | null }> {
  const { tx, actor, settings } = scope;
  const [found] = await tx
    .select({
      matter,
      ownerUserId: member.userId,
      ownerName: user.name,
      allowUserIds: matterRestriction.allowedUserIds,
    })
    .from(matter)
    .leftJoin(
      member,
      and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
    )
    .leftJoin(user, eq(user.id, member.userId))
    .leftJoin(
      matterRestriction,
      and(
        eq(matterRestriction.workspaceId, matter.workspaceId),
        eq(matterRestriction.matterId, matter.id),
      ),
    )
    .where(and(eq(matter.workspaceId, actor.workspaceId), eq(matter.id, matterId)))
    .limit(1);
  if (found === undefined) throw graphNotFound('matter');
  const resource = matterResource(
    actor.workspaceId,
    matterId,
    found.allowUserIds,
    found.ownerUserId,
  );
  if (!can(actor, 'matter.read', resource, settings).allow) throw graphNotFound('matter');
  const { ownerMemberId } = found.matter;
  return {
    row: found.matter,
    resource,
    owner:
      ownerMemberId !== null && found.ownerUserId !== null
        ? { memberId: ownerMemberId, userId: found.ownerUserId, name: found.ownerName ?? '' }
        : null,
  };
}

type ListingRow = typeof listing.$inferSelect;

function listingDetail(row: ListingRow): ListingDetail {
  return {
    date: row.listDate,
    proceedingId: row.proceedingId,
    listingId: row.id,
    sourceType: row.sourceType,
    confirmationState: row.confirmationState,
    stage: row.stageNorm ?? (row.stageRaw === '' ? null : row.stageRaw),
    canonical: row.canonical,
    provenance: {
      sourceType: row.sourceType,
      sourceRef: row.sourceRef,
      anchorId: row.anchorId,
      confidence: row.confidence,
      confirmationState: row.confirmationState,
      capturedAt: row.capturedAt,
    },
  };
}

const forumColumns = {
  id: forum.id,
  court: forum.court,
  establishment: forum.establishment,
  seat: forum.seat,
};

/** The proceedings of `matterIds`, earliest first, with their forums. */
async function proceedingsOf(tx: Transaction, workspaceId: string, matterIds: string[]) {
  if (matterIds.length === 0) return [];
  return tx
    .select({ proceeding, forum: forumColumns })
    .from(proceeding)
    .innerJoin(forum, eq(forum.id, proceeding.forumId))
    .where(and(eq(proceeding.workspaceId, workspaceId), inArray(proceeding.matterId, matterIds)))
    .orderBy(asc(proceeding.createdAt), asc(proceeding.id));
}

type ProceedingWithForum = Awaited<ReturnType<typeof proceedingsOf>>[number];

/** The earliest top-level main proceeding, else the earliest (rows are earliest first). */
function leadOf(rows: readonly ProceedingWithForum[]): ProceedingWithForum | undefined {
  return (
    rows.find((r) => r.proceeding.kind === 'main' && r.proceeding.parentProceedingId === null) ??
    rows[0]
  );
}

/** Per matter, the earliest canonical listing dated `day` or later. */
async function nextListings(
  tx: Transaction,
  workspaceId: string,
  matterIds: string[],
  day: string,
): Promise<Map<string, ListingRow>> {
  if (matterIds.length === 0) return new Map();
  const rows = await tx
    .selectDistinctOn([proceeding.matterId], { matterId: proceeding.matterId, listing })
    .from(listing)
    .innerJoin(
      proceeding,
      and(eq(proceeding.workspaceId, listing.workspaceId), eq(proceeding.id, listing.proceedingId)),
    )
    .where(
      and(
        eq(listing.workspaceId, workspaceId),
        inArray(proceeding.matterId, matterIds),
        eq(listing.canonical, true),
        sql`${listing.listDate} >= ${day}::date`,
      ),
    )
    .orderBy(asc(proceeding.matterId), asc(listing.listDate), asc(listing.id));
  return new Map(rows.map((r) => [r.matterId, r.listing]));
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list === undefined) out.set(k, [row]);
    else list.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// searchMatters.

/** What a search reads as a case number: a case type, a number and a year, each optional but the number. */
interface CaseNumberQuery {
  caseTypeCode?: string;
  number: string;
  year?: number;
}

/**
 * A search string as a case number, or null. `W.P. No. 12345 of 2026`, `WP 12345/2026`,
 * `wp-12345-26`, `WP12345/26`, `12345/2026` and `00045` all parse; the parts are normalised as the
 * stored identifiers are (`normaliseCaseType`, `normaliseCaseNumber`, `expandYear`).
 */
function parseCaseNumberQuery(q: string): CaseNumberQuery | null {
  const text = q
    .toUpperCase()
    .replace(/\bNO\b\.?/g, ' ')
    .replace(/\bOF\b/g, ' ');
  const match = /^\s*([A-Z][A-Z().\s_-]*?)?[\s./_-]*(\d+)(?:[\s./_-]+(\d{4}|\d{2}))?\s*$/.exec(
    text,
  );
  if (match === null) return null;
  const [, type, number, year] = match;
  if (number === undefined) return null;
  const code = type === undefined ? '' : type.replace(/[.\s\-_]/g, '');
  return {
    ...(code === '' ? {} : { caseTypeCode: normaliseCaseType(code) }),
    number: normaliseCaseNumber(number),
    ...(year === undefined ? {} : { year: expandYear(Number(year)) }),
  };
}

/** A stored identifier column compared to a normalised number (leading zeros dropped). */
function sameNumber(column: AnyColumn, value: string): SQL {
  return sql`regexp_replace(upper(${column}), '^0+(?=[0-9])', '') = ${value}`;
}

/** `matter.id in (...)` over the workspace's proceedings matching `where`, computed once. */
function matterWithProceeding(workspaceId: string, where: SQL): SQL {
  return sql`${matter.id} in (select ${proceeding.matterId} from ${proceeding} where ${proceeding.workspaceId} = ${workspaceId}::uuid and (${where}))`;
}

/**
 * The search predicate on `matter`: title, parties, people and case numbers. Each part is an
 * uncorrelated `in (...)`, evaluated once per query rather than once per matter.
 */
function searchPredicate(workspaceId: string, q: string): SQL {
  const pattern = containsPattern(q);
  const conditions: SQL[] = [
    sql`${matter.title} ilike ${pattern}`,
    matterWithProceeding(
      workspaceId,
      sql`${proceeding.titlePetitioner} ilike ${pattern} or ${proceeding.titleRespondent} ilike ${pattern}`,
    ),
    sql`${matter.id} in (select coalesce(${roleEdge.matterId}, ${proceeding.matterId}) from ${roleEdge}
      inner join ${person} on ${person.workspaceId} = ${roleEdge.workspaceId} and ${person.id} = ${roleEdge.fromPersonId}
      left join ${proceeding} on ${proceeding.workspaceId} = ${roleEdge.workspaceId} and ${proceeding.id} = ${roleEdge.proceedingId}
      where ${roleEdge.workspaceId} = ${workspaceId}::uuid
        and (${person.name} ilike ${pattern} or exists (select 1 from unnest(${person.aliases}) as alias(value) where alias.value ilike ${pattern})))`,
  ];
  const cnr = q.replace(/\s/g, '').toUpperCase();
  if (/^[A-Z0-9]{16}$/.test(cnr)) {
    conditions.push(matterWithProceeding(workspaceId, sql`${proceeding.cnr} = ${cnr}`));
  }
  const parsed = parseCaseNumberQuery(q);
  if (parsed !== null) {
    const parts: SQL[] = [sameNumber(proceeding.number, parsed.number)];
    if (parsed.caseTypeCode !== undefined) {
      parts.push(eq(proceeding.caseTypeCode, parsed.caseTypeCode));
    }
    if (parsed.year !== undefined) parts.push(eq(proceeding.year, parsed.year));
    const numbered = sql.join(parts, sql` and `);
    // Without a case type or year, the number may also be the SR, FR, diary or filing number.
    const other =
      parsed.caseTypeCode === undefined && parsed.year === undefined
        ? sql` or ${sql.join(
            [proceeding.srNo, proceeding.frNo, proceeding.diaryNo, proceeding.filingNo].map((c) =>
              sameNumber(c, parsed.number),
            ),
            sql` or `,
          )}`
        : sql``;
    conditions.push(matterWithProceeding(workspaceId, sql`(${numbered})${other}`));
  }
  return sql`(${sql.join(conditions, sql` or `)})`;
}

/** The sort key of a sort, its direction, and how its cursor text is cast back. */
function sortKey(sort: MatterSort, nextDate: SQL): { key: SQL; dir: 'asc' | 'desc'; cast: SQL } {
  switch (sort) {
    case 'next_date':
      return { key: sql`coalesce(${nextDate}, 'infinity'::date)`, dir: 'asc', cast: sql`date` };
    case 'updated':
      return { key: sql`${matter.updatedAt}`, dir: 'desc', cast: sql`timestamptz` };
    case 'title':
      return { key: sql`lower(${matter.title})`, dir: 'asc', cast: sql`text` };
  }
}

/**
 * The first query of `searchMatters`: the page's matters, their sort key as text and their owner
 * (`limit + 1` rows, to tell whether another page follows). Internal to the domain; the perf test
 * (__tests__/search-perf.test.ts) measures it with EXPLAIN ANALYZE.
 */
export function searchMattersQuery(
  tx: Transaction,
  resolved: Actor,
  settings: PolicySettings,
  data: ParsedSearchMatters,
  day: string,
  after?: readonly string[],
) {
  const { workspaceId } = resolved;
  const ownerUserId = sql`(select ${member.userId} from ${member} where ${member.organizationId} = ${matter.workspaceId} and ${member.id} = ${matter.ownerMemberId})`;
  // Each matter's next date, from one grouped pass over the upcoming canonical listings.
  const upcoming = tx
    .select({
      matterId: proceeding.matterId,
      nextDate: sql<string>`min(${listing.listDate})`.as('next_date'),
    })
    .from(listing)
    .innerJoin(
      proceeding,
      and(eq(proceeding.workspaceId, listing.workspaceId), eq(proceeding.id, listing.proceedingId)),
    )
    .where(
      and(
        eq(listing.workspaceId, workspaceId),
        eq(listing.canonical, true),
        sql`${listing.listDate} >= ${day}::date`,
      ),
    )
    .groupBy(proceeding.matterId)
    .as('upcoming');
  const nextDate = sql`${upcoming.nextDate}`;
  const conditions: SQL[] = [
    eq(matter.workspaceId, workspaceId),
    isNull(matter.mergedIntoMatterId),
    matterVisibilityPredicate(resolved, matter.id, { settings, ownerUserId }),
  ];
  if (data.status !== undefined) conditions.push(eq(matter.status, data.status));
  if (data.sensitive !== undefined) conditions.push(eq(matter.sensitive, data.sensitive));
  if (data.ownerMemberId !== undefined) {
    conditions.push(eq(matter.ownerMemberId, data.ownerMemberId));
  }
  if (data.forumId !== undefined) {
    conditions.push(
      matterWithProceeding(workspaceId, sql`${proceeding.forumId} = ${data.forumId}::uuid`),
    );
  }
  if (data.noNextDate === true) conditions.push(sql`${nextDate} is null`);
  if (data.noNextDate === false) conditions.push(sql`${nextDate} is not null`);
  if (data.q !== undefined) conditions.push(searchPredicate(workspaceId, data.q));

  const { key, dir, cast } = sortKey(data.sort, nextDate);
  if (after !== undefined) {
    const op = dir === 'asc' ? sql`>` : sql`<`;
    conditions.push(sql`(${key}, ${matter.id}) ${op} (${after[1]}::${cast}, ${after[2]}::uuid)`);
  }
  const order = dir === 'asc' ? [asc(key), asc(matter.id)] : [desc(key), desc(matter.id)];
  return tx
    .select({
      matter,
      keyText: sql<string>`(${key})::text`,
      ownerUserId: member.userId,
      ownerName: user.name,
    })
    .from(matter)
    .leftJoin(
      member,
      and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
    )
    .leftJoin(user, eq(user.id, member.userId))
    .leftJoin(upcoming, eq(upcoming.matterId, matter.id))
    .where(and(...conditions))
    .orderBy(...order)
    .limit(data.limit + 1);
}

/**
 * The workspace's matters the actor may read, one keyset page at a time (50 by default), for the
 * matters list and the command palette. Filters: status, forum (any proceeding), owner, no next
 * date, sensitive; `q` searches titles, parties, people and case numbers. Sorts: next date (nulls
 * last), last update (newest first), title. Merged matters are left out. A cursor works only with
 * the sort it came from.
 */
export async function searchMatters(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: SearchMattersInput = {},
): Promise<MatterListPage> {
  const data = parseInput(SearchMattersInput, input);
  const after = data.cursor === undefined ? undefined : decodeCursor(data.cursor, 3);
  if (after !== undefined && after[0] !== data.sort) throw invalid('Invalid cursor');
  const day = today(deps);
  return inGraphScope(deps, actor, async ({ tx, actor: resolved, settings }) => {
    if (!can(resolved, 'matter.read', undefined, settings).allow) {
      return { items: [], nextCursor: null };
    }
    const { workspaceId } = resolved;
    const rows = await searchMattersQuery(tx, resolved, settings, data, day, after);
    const page = rows.slice(0, data.limit);
    const ids = page.map((r) => r.matter.id);
    const proceedings = groupBy(
      await proceedingsOf(tx, workspaceId, ids),
      (r) => r.proceeding.matterId,
    );
    const next = await nextListings(tx, workspaceId, ids, day);
    const last = page.at(-1);
    return {
      items: page.map(({ matter: m, ownerUserId: ownerUser, ownerName }) => {
        const own = proceedings.get(m.id) ?? [];
        const lead = leadOf(own);
        const listed = next.get(m.id);
        return {
          id: m.id,
          title: m.title,
          status: m.status,
          sensitive: m.sensitive,
          petitioner: lead?.proceeding.titlePetitioner ?? null,
          respondent: lead?.proceeding.titleRespondent ?? null,
          forum: lead?.forum ?? null,
          stage: listed === undefined ? null : listingDetail(listed).stage,
          proceedingCount: own.length,
          nextDate:
            listed === undefined
              ? null
              : {
                  date: listed.listDate,
                  proceedingId: listed.proceedingId,
                  listingId: listed.id,
                  sourceType: listed.sourceType,
                  confirmationState: listed.confirmationState,
                },
          owner:
            m.ownerMemberId !== null && ownerUser !== null
              ? { memberId: m.ownerMemberId, userId: ownerUser, name: ownerName ?? '' }
              : null,
          updatedAt: m.updatedAt,
        };
      }),
      nextCursor:
        rows.length > data.limit && last !== undefined
          ? encodeCursor([data.sort, last.keyText, last.matter.id])
          : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// People and documents of one matter.

async function peopleOf(
  tx: Transaction,
  workspaceId: string,
  matterId: string,
): Promise<MatterPeopleGroup[]> {
  const rows = await tx
    .select({ edge: roleEdge, person })
    .from(roleEdge)
    .innerJoin(
      person,
      and(eq(person.workspaceId, roleEdge.workspaceId), eq(person.id, roleEdge.fromPersonId)),
    )
    .where(
      and(
        eq(roleEdge.workspaceId, workspaceId),
        or(
          eq(roleEdge.matterId, matterId),
          inArray(
            roleEdge.proceedingId,
            tx
              .select({ id: proceeding.id })
              .from(proceeding)
              .where(
                and(eq(proceeding.workspaceId, workspaceId), eq(proceeding.matterId, matterId)),
              ),
          ),
        ),
      ),
    )
    .orderBy(asc(roleEdge.createdAt), asc(roleEdge.id));
  const byKind = groupBy(rows, (r) => r.edge.kind);
  return ROLE_EDGE_KINDS.map((kind) => ({
    kind,
    edges: (byKind.get(kind) ?? []).map(({ edge, person: p }) => ({
      edgeId: edge.id,
      proceedingId: edge.proceedingId,
      person: {
        id: p.id,
        name: p.name,
        aliases: p.aliases,
        kind: p.kind,
        contact: p.kind === 'client' || p.kind === 'professional' ? p.contact : null,
      },
      provenance: { sourceType: edge.sourceType, confirmationState: edge.confirmationState },
    })),
  }));
}

async function documentsOf(
  tx: Transaction,
  workspaceId: string,
  matterId: string,
  limit: number,
  after?: { createdAt: string; id: string },
): Promise<{ items: MatterDocumentRow[]; keys: string[]; more: boolean }> {
  const conditions: SQL[] = [
    eq(document.workspaceId, workspaceId),
    eq(document.matterId, matterId),
  ];
  if (after !== undefined) {
    conditions.push(
      sql`(${document.createdAt}, ${document.id}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`,
    );
  }
  const rows = await tx
    .select({
      document,
      keyText: sql<string>`${document.createdAt}::text`,
      // Spelled out: drizzle leaves the columns of a single-table selection unqualified.
      supersededBy: sql<
        string | null
      >`(select later.id from "document" as later where later.workspace_id = "document"."workspace_id" and later.supersedes_document_id = "document"."id" order by later.created_at, later.id limit 1)`,
    })
    .from(document)
    .where(and(...conditions))
    .orderBy(desc(document.createdAt), desc(document.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map(({ document: d, supersededBy }) => ({
      id: d.id,
      kind: d.kind,
      language: d.language,
      textStatus: d.textStatus,
      source:
        d.sourceCaptureId === null
          ? { type: 'manual' as const }
          : { type: 'capture' as const, captureId: d.sourceCaptureId },
      supersedesDocumentId: d.supersedesDocumentId,
      supersededByDocumentId: supersededBy,
      createdAt: d.createdAt,
    })),
    keys: page.map((r) => r.keyText),
    more: rows.length > limit,
  };
}

/**
 * The matter's people, grouped by role edge kind: edges to the matter and to its proceedings.
 * Contact details appear only for clients and professional contacts.
 */
export async function listMatterPeople(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: MatterReadInput,
): Promise<MatterPeopleGroup[]> {
  const { matterId } = parseInput(MatterReadInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    await readableMatter(scope, matterId);
    return peopleOf(scope.tx, scope.actor.workspaceId, matterId);
  });
}

/**
 * The matter's documents, newest first, one keyset page at a time: kind, language, text status,
 * source and version chain. Needs `document.read` on the matter (FORBIDDEN otherwise).
 */
export async function listMatterDocuments(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: ListMatterDocumentsInput,
): Promise<MatterDocumentPage> {
  const data = parseInput(ListMatterDocumentsInput, input);
  const after = data.cursor === undefined ? undefined : decodeCursor(data.cursor, 2);
  return inGraphScope(deps, actor, async (scope) => {
    const { resource } = await readableMatter(scope, data.matterId);
    if (!can(scope.actor, 'document.read', resource, scope.settings).allow) {
      throw forbidden('You cannot see the documents of this matter');
    }
    const { items, keys, more } = await documentsOf(
      scope.tx,
      scope.actor.workspaceId,
      data.matterId,
      data.limit,
      after === undefined ? undefined : { createdAt: after[0] ?? '', id: after[1] ?? '' },
    );
    const lastKey = keys.at(-1);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        more && last !== undefined && lastKey !== undefined
          ? encodeCursor([lastKey, last.id])
          : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// The proceedings tree and the Overview.

/**
 * The matter's proceedings as a forest by parent (children earliest first), each with its
 * identifiers, state, forum, canonical next date and the links touching it. A link to another
 * matter names that matter only when the actor may read it.
 */
export async function listMatterProceedingsTree(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: MatterReadInput,
): Promise<ProceedingNode[]> {
  const { matterId } = parseInput(MatterReadInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    await readableMatter(scope, matterId);
    const { tx, settings } = scope;
    const { workspaceId } = scope.actor;
    const rows = await proceedingsOf(tx, workspaceId, [matterId]);
    const ids = rows.map((r) => r.proceeding.id);
    if (ids.length === 0) return [];
    const canonical = await tx
      .select()
      .from(listing)
      .where(
        and(
          eq(listing.workspaceId, workspaceId),
          inArray(listing.proceedingId, ids),
          eq(listing.canonical, true),
        ),
      );
    const canonicalOf = new Map(canonical.map((l) => [l.proceedingId, l]));
    const links = await tx
      .select({
        link: proceedingLink,
        // Spelled out: drizzle leaves the columns of a single-table selection unqualified.
        fromMatterId: sql<string>`(select p.matter_id from "proceeding" as p where p.workspace_id = "proceeding_link"."workspace_id" and p.id = "proceeding_link"."from_proceeding_id")`,
        toMatterId: sql<string>`(select p.matter_id from "proceeding" as p where p.workspace_id = "proceeding_link"."workspace_id" and p.id = "proceeding_link"."to_proceeding_id")`,
      })
      .from(proceedingLink)
      .where(
        and(
          eq(proceedingLink.workspaceId, workspaceId),
          or(
            inArray(proceedingLink.fromProceedingId, ids),
            inArray(proceedingLink.toProceedingId, ids),
          ),
        ),
      )
      .orderBy(asc(proceedingLink.createdAt), asc(proceedingLink.id));
    const others = [
      ...new Set(
        links.flatMap((l) => [l.fromMatterId, l.toMatterId]).filter((id) => id !== matterId),
      ),
    ];
    const visible = new Set<string>();
    if (others.length > 0) {
      const ownerUserId = sql`(select ${member.userId} from ${member} where ${member.organizationId} = ${matter.workspaceId} and ${member.id} = ${matter.ownerMemberId})`;
      const readable = await tx
        .select({ id: matter.id })
        .from(matter)
        .where(
          and(
            eq(matter.workspaceId, workspaceId),
            inArray(matter.id, others),
            matterVisibilityPredicate(scope.actor, matter.id, { settings, ownerUserId }),
          ),
        );
      for (const r of readable) visible.add(r.id);
    }
    const linksOf = (id: string): ProceedingLinkView[] =>
      links.flatMap(({ link, fromMatterId, toMatterId }): ProceedingLinkView[] => {
        const views: ProceedingLinkView[] = [];
        const view = (direction: 'from' | 'to', other: string, otherMatter: string) => ({
          linkId: link.id,
          kind: link.kind,
          direction,
          otherProceedingId: other,
          otherMatterId: otherMatter !== matterId && visible.has(otherMatter) ? otherMatter : null,
        });
        if (link.fromProceedingId === id) views.push(view('from', link.toProceedingId, toMatterId));
        if (link.toProceedingId === id) views.push(view('to', link.fromProceedingId, fromMatterId));
        return views;
      });
    const nodes = new Map<string, ProceedingNode>();
    for (const { proceeding: p, forum: f } of rows) {
      const listed = canonicalOf.get(p.id);
      nodes.set(p.id, {
        id: p.id,
        kind: p.kind,
        state: p.state,
        caseType: p.caseTypeRaw ?? p.caseTypeCode,
        caseTypeCode: p.caseTypeCode,
        number: p.number,
        year: p.year,
        srNo: p.srNo,
        frNo: p.frNo,
        diaryNo: p.diaryNo,
        filingNo: p.filingNo,
        cnr: p.cnr,
        unnumbered: p.number === null,
        petitioner: p.titlePetitioner,
        respondent: p.titleRespondent,
        forum: f,
        nextDate: listed === undefined ? null : listingDetail(listed),
        links: linksOf(p.id),
        children: [],
      });
    }
    const roots: ProceedingNode[] = [];
    for (const { proceeding: p } of rows) {
      const node = nodes.get(p.id);
      if (node === undefined) continue;
      const parent = p.parentProceedingId === null ? undefined : nodes.get(p.parentProceedingId);
      if (parent === undefined || parent === node) roots.push(node);
      else parent.children.push(node);
    }
    return roots;
  });
}

/**
 * The Overview of a matter: header, next date with provenance, unresolved date conflicts, a
 * proceedings summary, the open obligations count, recent documents, people and the synopsis
 * (only with `strategy.read`).
 */
export async function getMatterOverview(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: MatterReadInput,
): Promise<MatterOverview> {
  const { matterId } = parseInput(MatterReadInput, input);
  const day = today(deps);
  return inGraphScope(deps, actor, async (scope) => {
    const { row, resource, owner } = await readableMatter(scope, matterId);
    const { tx, settings } = scope;
    const { workspaceId } = scope.actor;
    const rows = await proceedingsOf(tx, workspaceId, [matterId]);
    const ids = rows.map((r) => r.proceeding.id);
    const listings =
      ids.length === 0
        ? []
        : await tx
            .select()
            .from(listing)
            .where(
              and(
                eq(listing.workspaceId, workspaceId),
                inArray(listing.proceedingId, ids),
                or(
                  eq(listing.canonical, true),
                  and(
                    eq(listing.confirmationState, 'proposed'),
                    sql`${listing.listDate} >= ${day}::date`,
                  ),
                ),
              ),
            )
            .orderBy(asc(listing.listDate), asc(listing.id));
    const canonical = new Map(listings.filter((l) => l.canonical).map((l) => [l.proceedingId, l]));
    const upcoming = [...canonical.values()]
      .filter((l) => l.listDate >= day)
      .sort((a, b) => a.listDate.localeCompare(b.listDate) || a.id.localeCompare(b.id));
    const conflicts: NextDateConflictView[] = [];
    for (const proposed of listings) {
      if (proposed.canonical) continue;
      const current = canonical.get(proposed.proceedingId);
      if (current === undefined || current.listDate === proposed.listDate) continue;
      conflicts.push({
        proceedingId: proposed.proceedingId,
        current: listingDetail(current),
        proposed: listingDetail(proposed),
      });
    }
    const byState: Partial<Record<ProceedingState, number>> = {};
    for (const { proceeding: p } of rows) byState[p.state] = (byState[p.state] ?? 0) + 1;
    const lead = leadOf(rows);
    const [open] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(obligation)
      .where(
        and(
          eq(obligation.workspaceId, workspaceId),
          eq(obligation.matterId, matterId),
          eq(obligation.status, 'open'),
        ),
      );
    const recentDocuments = can(scope.actor, 'document.read', resource, settings).allow
      ? (await documentsOf(tx, workspaceId, matterId, 5)).items
      : [];
    const people = await peopleOf(tx, workspaceId, matterId);
    const clients = new Map<string, PersonView>();
    for (const group of people) {
      for (const edge of group.edges) {
        if (edge.person.kind === 'client') clients.set(edge.person.id, edge.person);
      }
    }
    const strategy = can(scope.actor, 'strategy.read', resource, settings).allow;
    const nextListing = upcoming[0];
    return {
      header: {
        id: row.id,
        title: row.title,
        status: row.status,
        sensitive: row.sensitive,
        practiceArea: row.practiceArea,
        openedAt: row.openedAt,
        updatedAt: row.updatedAt,
        owner,
        clients: [...clients.values()],
      },
      nextDate: nextListing === undefined ? null : listingDetail(nextListing),
      conflicts,
      proceedings: {
        count: rows.length,
        byState,
        lead:
          lead === undefined
            ? null
            : {
                id: lead.proceeding.id,
                caseType: lead.proceeding.caseTypeRaw ?? lead.proceeding.caseTypeCode,
                number: lead.proceeding.number,
                year: lead.proceeding.year,
                forum: lead.forum,
              },
      },
      openObligations: open?.count ?? 0,
      recentDocuments,
      people,
      synopsis:
        strategy && row.synopsis !== null
          ? { text: row.synopsis, provenance: { sourceType: 'manual' } }
          : null,
      synopsisDenied: !strategy,
    };
  });
}
