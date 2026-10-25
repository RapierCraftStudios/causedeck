// The public developer API reads (#625, part 2 of #487, D-048). Every record leaves with its
// provenance and a `source_license`, and fails closed: a record is served only when its source is
// cleared (`decideSourceClearance`), and shared (global) records only when the source is also
// `non-personal` (`exposableThroughApi`). Personal data leaves only for the caller's own matters,
// read under the workspace scope. Nothing here carries a contributor workspace, a party name from
// shared data, or any judge rating, ranking or prediction (D-048, D-050).
import { schema, withWorkspace, isUuid, type Queryable } from '@causedeck/db';
import { and, desc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import { decideSourceClearance, exposableThroughApi } from '../sources/index.ts';

const {
  source,
  proceeding,
  matter,
  caseWatch,
  caseStatusSnapshot,
  causeListWatch,
  contributedDocument,
  notice,
} = schema;

/** Records returned per read. */
export const PUBLIC_API_MAX_LIMIT = 100;
export const PUBLIC_API_DEFAULT_LIMIT = 50;

export interface PublicProvenance {
  sourceId: string;
  /** `fetched` from a cleared source, or `contributed` (a shared public copy). */
  kind: 'fetched' | 'contributed';
  /** Where the record came from: a source reference or the official URL. */
  ref: string | null;
  capturedAt: Date;
  confidence: number | null;
}

export interface PublicRecord {
  provenance: PublicProvenance;
  /** The terms the record is served under (derived from the source; see `sourceLicense`). */
  sourceLicense: string;
}

/** The licence line for a record: derived from the source owner, as the registry has no licence text. */
export function sourceLicense(owner: string, kind: PublicProvenance['kind']): string {
  return kind === 'contributed'
    ? `contributed-public-document; original publisher: ${owner}`
    : `${owner} public record (terms and counsel cleared)`;
}

interface ServedSource {
  id: string;
  owner: string;
}

/** The sources among `ids` that may be served; `sharedOnly` also demands a non-personal data class. */
async function servableSources(
  db: Queryable,
  ids: readonly string[],
  shared: boolean,
): Promise<Map<string, ServedSource>> {
  const served = new Map<string, ServedSource>();
  if (ids.length === 0) return served;
  const rows = await db
    .select()
    .from(source)
    .where(inArray(source.id, [...new Set(ids)]));
  for (const row of rows) {
    if (decideSourceClearance(row) !== null) continue;
    if (shared && !exposableThroughApi(row.dataClass)) continue;
    served.set(row.id, { id: row.id, owner: row.owner });
  }
  return served;
}

const clampLimit = (limit: number | undefined) =>
  Math.min(Math.max(limit ?? PUBLIC_API_DEFAULT_LIMIT, 1), PUBLIC_API_MAX_LIMIT);

const toNumber = (value: string | null) => (value === null ? null : Number(value));

export interface PublicActor {
  workspaceId: string;
  userId: string;
}

export interface PublicOrder {
  date: string | null;
  number: string | null;
  summary: string | null;
  url: string | null;
}

export interface PublicCase extends PublicRecord {
  cnr: string;
  status: string | null;
  nextHearingDate: string | null;
  lastHearingDate: string | null;
  stage: string | null;
  bench: string | null;
  fetchedAt: Date;
  orders: PublicOrder[];
}

interface SnapshotFields {
  status?: unknown;
  nextHearingDate?: unknown;
  lastHearingDate?: unknown;
  stage?: { raw?: unknown } | null;
  bench?: unknown;
  orders?: unknown;
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function ordersOf(fields: SnapshotFields): PublicOrder[] {
  if (!Array.isArray(fields.orders)) return [];
  return (fields.orders as Record<string, unknown>[]).map((o) => ({
    date: str(o.date),
    number: str(o.number),
    summary: str(o.summary),
    url: str(o.href),
  }));
}

/** Snapshots of the caller's own, non-sensitive proceedings (newest first), optionally by CNR. */
async function ownSnapshots(db: Queryable, actor: PublicActor, cnr: string | undefined) {
  return withWorkspace(db, actor, (tx) =>
    tx
      .select({
        cnr: sql<string | null>`coalesce(${caseWatch.cnr}, ${proceeding.cnr})`,
        sourceId: caseWatch.sourceId,
        fields: caseStatusSnapshot.fields,
        fetchedAt: caseStatusSnapshot.fetchedAt,
        sourceRef: caseStatusSnapshot.sourceRef,
        capturedAt: caseStatusSnapshot.capturedAt,
        confidence: caseStatusSnapshot.confidence,
      })
      .from(caseStatusSnapshot)
      .innerJoin(
        caseWatch,
        and(
          eq(caseWatch.workspaceId, caseStatusSnapshot.workspaceId),
          eq(caseWatch.id, caseStatusSnapshot.watchId),
        ),
      )
      .innerJoin(
        proceeding,
        and(
          eq(proceeding.workspaceId, caseWatch.workspaceId),
          eq(proceeding.id, caseWatch.proceedingId),
        ),
      )
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
      )
      .where(
        and(
          eq(caseStatusSnapshot.workspaceId, actor.workspaceId),
          eq(matter.sensitive, false),
          cnr === undefined
            ? sql`coalesce(${caseWatch.cnr}, ${proceeding.cnr}) is not null`
            : or(eq(caseWatch.cnr, cnr), eq(proceeding.cnr, cnr)),
        ),
      )
      .orderBy(desc(caseStatusSnapshot.fetchedAt))
      .limit(PUBLIC_API_MAX_LIMIT * 4),
  );
}

/**
 * The latest status of one of the caller's own cases, from a cleared source; `null` when the CNR is
 * not a non-sensitive proceeding of the workspace (another workspace's case is the same `null`).
 */
export async function getPublicCase(
  db: Queryable,
  actor: PublicActor,
  cnr: string,
): Promise<PublicCase | null> {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) return null;
  const rows = await ownSnapshots(db, actor, cnr);
  const servable = await servableSources(
    db,
    rows.map((r) => r.sourceId),
    false,
  );
  for (const row of rows) {
    const origin = servable.get(row.sourceId);
    if (origin === undefined || row.cnr === null) continue;
    const fields = row.fields as SnapshotFields;
    return {
      cnr: row.cnr,
      status: str(fields.status),
      nextHearingDate: str(fields.nextHearingDate),
      lastHearingDate: str(fields.lastHearingDate),
      stage: str(fields.stage?.raw),
      bench: str(fields.bench),
      fetchedAt: row.fetchedAt,
      orders: ordersOf(fields),
      provenance: {
        sourceId: origin.id,
        kind: 'fetched',
        ref: row.sourceRef,
        capturedAt: row.capturedAt,
        confidence: toNumber(row.confidence),
      },
      sourceLicense: sourceLicense(origin.owner, 'fetched'),
    };
  }
  return null;
}

export interface PublicSharedDocument extends PublicRecord {
  id: string;
  forum: string | null;
  listingDate: string | null;
  content: string;
}

export interface PublicOrderRecord extends PublicRecord {
  id: string;
  case: string | null;
  date: string | null;
  number: string | null;
  summary: string | null;
  url: string | null;
  /** The text of a shared public order; null for an order read from the caller's own case. */
  content: string | null;
  forum: string | null;
}

export interface SharedQuery {
  forum?: string;
  date?: string;
  limit?: number;
  now?: Date;
}

async function sharedDocuments(
  db: Queryable,
  kind: schema.ContributableKind,
  query: SharedQuery,
  onlySources?: readonly string[],
) {
  if (onlySources?.length === 0) return [];
  const rows = await db
    .select()
    .from(contributedDocument)
    .where(
      and(
        eq(contributedDocument.kind, kind),
        isNull(contributedDocument.withdrawnAt),
        gt(contributedDocument.retentionUntil, query.now ?? new Date()),
        query.forum === undefined
          ? undefined
          : ilike(contributedDocument.forumLabel, query.forum.replace(/[%_\\]/g, '\\$&')),
        query.date === undefined ? undefined : eq(contributedDocument.listingDate, query.date),
        onlySources === undefined
          ? undefined
          : inArray(contributedDocument.sourceId, [...onlySources]),
      ),
    )
    .orderBy(desc(contributedDocument.contributedAt))
    .limit(PUBLIC_API_MAX_LIMIT * 4);
  const servable = await servableSources(
    db,
    rows.map((r) => r.sourceId),
    true,
  );
  return rows.flatMap((row) => {
    const origin = servable.get(row.sourceId);
    return origin === undefined || row.content === null
      ? []
      : [{ row, origin, content: row.content }];
  });
}

/**
 * Shared cause lists from cleared non-personal sources. `advocate` narrows to the sources the
 * workspace watches under that name or BRN: it is never a search over shared text.
 */
export async function listPublicCauseLists(
  db: Queryable,
  actor: PublicActor,
  query: SharedQuery & { advocate?: string },
): Promise<PublicSharedDocument[]> {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) return [];
  let onlySources: string[] | undefined;
  if (query.advocate !== undefined) {
    const advocate = query.advocate;
    const watches = await withWorkspace(db, actor, (tx) =>
      tx
        .select({ sourceId: causeListWatch.sourceId })
        .from(causeListWatch)
        .where(
          and(
            eq(causeListWatch.workspaceId, actor.workspaceId),
            sql`lower(${causeListWatch.value}) = lower(${advocate})`,
          ),
        ),
    );
    onlySources = [...new Set(watches.map((w) => w.sourceId))];
  }
  const docs = await sharedDocuments(db, 'cause_list', query, onlySources);
  return docs.slice(0, clampLimit(query.limit)).map(({ row, origin, content }) => ({
    id: row.id,
    forum: row.forumLabel,
    listingDate: row.listingDate,
    content,
    provenance: {
      sourceId: origin.id,
      kind: 'contributed',
      ref: null,
      capturedAt: row.contributedAt,
      confidence: null,
    },
    sourceLicense: sourceLicense(origin.owner, 'contributed'),
  }));
}

/**
 * Orders: with `caseCnr`, the orders of the caller's own case (cleared source); without it, shared
 * published orders from cleared non-personal sources.
 */
export async function listPublicOrders(
  db: Queryable,
  actor: PublicActor,
  query: SharedQuery & { caseCnr?: string },
): Promise<PublicOrderRecord[]> {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) return [];
  const limit = clampLimit(query.limit);
  if (query.caseCnr !== undefined) {
    const found = await getPublicCase(db, actor, query.caseCnr);
    if (found === null) return [];
    return found.orders.slice(0, limit).map((order) => ({
      id: `${found.cnr}:${order.number ?? order.date ?? ''}`,
      case: found.cnr,
      ...order,
      content: null,
      forum: null,
      provenance: found.provenance,
      sourceLicense: found.sourceLicense,
    }));
  }
  const docs = await sharedDocuments(db, 'order', query);
  return docs.slice(0, limit).map(({ row, origin, content }) => ({
    id: row.id,
    case: null,
    date: row.listingDate,
    number: null,
    summary: null,
    url: null,
    content,
    forum: row.forumLabel,
    provenance: {
      sourceId: origin.id,
      kind: 'contributed',
      ref: null,
      capturedAt: row.contributedAt,
      confidence: null,
    },
    sourceLicense: sourceLicense(origin.owner, 'contributed'),
  }));
}

export interface PublicNotice extends PublicRecord {
  id: string;
  title: string;
  kind: string;
  issuedOn: string;
  effectiveOn: string | null;
  url: string;
  forumCodes: string[];
}

/** Official notices from cleared non-personal sources, newest issued first; global data, no tenant fields. */
export async function listPublicNotices(
  db: Queryable,
  query: { forum?: string; limit?: number },
): Promise<PublicNotice[]> {
  const rows = await db
    .select()
    .from(notice)
    .where(query.forum === undefined ? undefined : sql`${query.forum} = any(${notice.forumCodes})`)
    .orderBy(desc(notice.issuedOn), desc(notice.createdAt))
    .limit(PUBLIC_API_MAX_LIMIT * 4);
  const servable = await servableSources(
    db,
    rows.map((r) => r.sourceId),
    true,
  );
  return rows
    .flatMap((row) => {
      const origin = servable.get(row.sourceId);
      return origin === undefined ? [] : [{ row, origin }];
    })
    .slice(0, clampLimit(query.limit))
    .map(({ row, origin }) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      issuedOn: row.issuedOn,
      effectiveOn: row.effectiveOn,
      url: row.url,
      forumCodes: row.forumCodes,
      provenance: {
        sourceId: origin.id,
        kind: 'fetched',
        ref: row.sourceRef ?? row.url,
        capturedAt: row.capturedAt,
        confidence: toNumber(row.confidence),
      },
      sourceLicense: sourceLicense(origin.owner, 'fetched'),
    }));
}
