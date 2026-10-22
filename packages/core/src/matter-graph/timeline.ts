// The cross-proceeding timeline of a matter (#366, part 5 of #33). `getMatterTimeline` reads the
// matter's listings, hearings, orders, obligation due dates and closures, proceeding state changes
// (`proceeding_state_change`, #363, ADR 0016) and document additions, across all its proceedings,
// as one chronologically sorted `TimelineEvent` list. It only reads: no writes, no events.
//
// - Every event carries `proceedingId` (null for a document and a matter-level obligation, which
//   have none), `provenance` and `anchorId`. A document has no provenance columns, so its
//   provenance says where the file came from: its capture, or a manual upload.
// - Order: by instant (`at`), then a fixed kind rank, then id. A fact dated by a court day sits at
//   00:00 Asia/Kolkata on that day; `date` is the court day of every event. `from`/`to` are
//   inclusive court days.
// - `bench_change` is declared for #39 and never produced yet.
// - Each kind is one indexed select (`timelineStatements`); hearings are found by the ids of the
//   matter's listings (`listingKeys`). The perf test EXPLAINs the same builders.
import { schema, type Transaction } from '@causedeck/db';
import {
  GetMatterTimelineInput,
  TIMELINE_EVENT_KINDS,
  type TimelineEventKind,
} from '@causedeck/validators/matter-graph-inputs';
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  ne,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';

import {
  inGraphScope,
  parseInput,
  requireMatter,
  type GraphActor,
  type MatterGraphDeps,
} from './context.ts';
import type { StateChangeProvenance } from './events.ts';

const { document, hearing, listing, obligation, order, proceeding, proceedingStateChange } = schema;

export type { TimelineEventKind };

/** Where a timeline fact came from. */
export type TimelineProvenance = StateChangeProvenance;

interface TimelineEventBase {
  /** The id of the source row (listing, hearing, order, obligation, state change, document). */
  id: string;
  matterId: string;
  proceedingId: string | null;
  /** The court day (Asia/Kolkata), `YYYY-MM-DD`. */
  date: string;
  /** The instant the event sorts by, ISO-8601. */
  at: string;
  provenance: TimelineProvenance;
  anchorId: string | null;
}

type ListingRow = typeof listing.$inferSelect;
type OrderRow = typeof order.$inferSelect;
type ObligationRow = typeof obligation.$inferSelect;
type StateChangeRow = typeof proceedingStateChange.$inferSelect;
type DocumentRow = typeof document.$inferSelect;

export type TimelineEvent =
  | (TimelineEventBase & {
      kind: 'listing';
      listType: ListingRow['listType'];
      stageRaw: string;
      stageNorm: string | null;
      canonical: boolean;
      benchId: string | null;
      hallId: string | null;
      listNo: number | null;
      itemNo: string | null;
    })
  | (TimelineEventBase & {
      kind: 'hearing';
      listingId: string;
      outcome: string | null;
      adjournmentReason: string | null;
      nextDateProposed: string | null;
      nextDateConfirmed: string | null;
    })
  | (TimelineEventBase & {
      kind: 'order';
      documentId: string;
      orderType: OrderRow['orderType'];
      benchId: string | null;
      nextDate: string | null;
    })
  | (TimelineEventBase & {
      kind: 'obligation_due';
      obligationId: string;
      description: string;
      status: ObligationRow['status'];
      source: ObligationRow['source'];
    })
  | (TimelineEventBase & {
      kind: 'obligation_closed';
      obligationId: string;
      description: string;
      status: ObligationRow['status'];
      closedReasonType: ObligationRow['closedReasonType'];
    })
  | (TimelineEventBase & {
      kind: 'state_change';
      from: StateChangeRow['fromState'];
      to: StateChangeRow['toState'];
      reason: string | null;
      actorMemberId: string | null;
      cureDeadline: string | null;
    })
  | (TimelineEventBase & {
      kind: 'document_added';
      documentId: string;
      documentKind: DocumentRow['kind'];
      supersedesDocumentId: string | null;
    })
  // Reserved for #39 (bench changes); never produced yet.
  | (TimelineEventBase & {
      kind: 'bench_change';
      fromBenchId: string | null;
      toBenchId: string | null;
    });

/** Same-instant events sort in this order. */
const KIND_RANK: Record<TimelineEventKind, number> = {
  state_change: 0,
  document_added: 1,
  listing: 2,
  hearing: 3,
  order: 4,
  obligation_due: 5,
  obligation_closed: 6,
  bench_change: 7,
};

export interface TimelineFilter {
  from?: string | undefined;
  to?: string | undefined;
  kinds: ReadonlySet<TimelineEventKind>;
}

/** Court dates are Indian: Asia/Kolkata has a fixed +05:30 offset. */
const COURT_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The instant of 00:00 Asia/Kolkata on `day`. */
function dayStart(day: string): string {
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

/** The bounds on a `date` column. */
function onDays(column: AnyColumn, filter: TimelineFilter): SQL[] {
  return [
    ...(filter.from === undefined ? [] : [gte(column, filter.from)]),
    ...(filter.to === undefined ? [] : [lte(column, filter.to)]),
  ];
}

/** The bounds on a `timestamptz` column, by its court day. */
function onInstants(column: AnyColumn, filter: TimelineFilter): SQL[] {
  const day = sql`(${column} at time zone 'Asia/Kolkata')::date`;
  return [
    ...(filter.from === undefined ? [] : [sql`${day} >= ${filter.from}::date`]),
    ...(filter.to === undefined ? [] : [sql`${day} <= ${filter.to}::date`]),
  ];
}

/** The matter's proceedings (internal; the first select of every timeline). */
export function proceedingKeys(tx: Transaction, workspaceId: string, matterId: string) {
  return tx
    .select({ id: proceeding.id })
    .from(proceeding)
    .where(and(eq(proceeding.workspaceId, workspaceId), eq(proceeding.matterId, matterId)));
}

/**
 * The listings of the proceedings, unbounded by date (internal): hearings are found by these ids
 * rather than by a join, so the plan does not hinge on row estimates (a join planned on a freshly
 * filled, unanalysed table nested-looped every hearing against every listing).
 */
export function listingKeys(
  tx: Transaction,
  workspaceId: string,
  proceedingIds: readonly string[],
) {
  return tx
    .select({ id: listing.id, proceedingId: listing.proceedingId })
    .from(listing)
    .where(
      and(eq(listing.workspaceId, workspaceId), inArray(listing.proceedingId, [...proceedingIds])),
    );
}

/**
 * The select of each requested kind (internal; the perf test EXPLAINs them). Proceeding-keyed kinds
 * are absent when the matter has no proceedings, hearings when it has no listings.
 */
export function timelineStatements(
  tx: Transaction,
  workspaceId: string,
  matterId: string,
  proceedingIds: readonly string[],
  listingIds: readonly string[],
  filter: TimelineFilter,
) {
  const wants = (kind: TimelineEventKind) => filter.kinds.has(kind);
  const ofProceedings = proceedingIds.length > 0;
  return {
    listing:
      wants('listing') && ofProceedings
        ? tx
            .select()
            .from(listing)
            .where(
              and(
                eq(listing.workspaceId, workspaceId),
                inArray(listing.proceedingId, [...proceedingIds]),
                ...onDays(listing.listDate, filter),
              ),
            )
        : undefined,
    hearing:
      wants('hearing') && listingIds.length > 0
        ? tx
            .select()
            .from(hearing)
            .where(
              and(
                eq(hearing.workspaceId, workspaceId),
                inArray(hearing.listingId, [...listingIds]),
                ...onDays(hearing.heldOn, filter),
              ),
            )
        : undefined,
    order:
      wants('order') && ofProceedings
        ? tx
            .select()
            .from(order)
            .where(
              and(
                eq(order.workspaceId, workspaceId),
                inArray(order.proceedingId, [...proceedingIds]),
                ...onDays(order.orderDate, filter),
              ),
            )
        : undefined,
    obligationDue: wants('obligation_due')
      ? tx
          .select()
          .from(obligation)
          .where(
            and(
              eq(obligation.workspaceId, workspaceId),
              eq(obligation.matterId, matterId),
              isNotNull(obligation.dueDate),
              ...onDays(obligation.dueDate, filter),
            ),
          )
      : undefined,
    obligationClosed: wants('obligation_closed')
      ? tx
          .select()
          .from(obligation)
          .where(
            and(
              eq(obligation.workspaceId, workspaceId),
              eq(obligation.matterId, matterId),
              ne(obligation.status, 'open'),
              isNotNull(obligation.closedAt),
              ...onInstants(obligation.closedAt, filter),
            ),
          )
      : undefined,
    stateChange:
      wants('state_change') && ofProceedings
        ? tx
            .select()
            .from(proceedingStateChange)
            .where(
              and(
                eq(proceedingStateChange.workspaceId, workspaceId),
                inArray(proceedingStateChange.proceedingId, [...proceedingIds]),
                ...onInstants(proceedingStateChange.changedAt, filter),
              ),
            )
        : undefined,
    documentAdded: wants('document_added')
      ? tx
          .select()
          .from(document)
          .where(
            and(
              eq(document.workspaceId, workspaceId),
              eq(document.matterId, matterId),
              ...onInstants(document.createdAt, filter),
            ),
          )
      : undefined,
  };
}

interface ProvenanceColumns {
  sourceType: TimelineProvenance['sourceType'];
  sourceRef: string | null;
  anchorId: string | null;
  confidence: string | null;
  confirmationState: TimelineProvenance['confirmationState'];
}

function provenanceOf(row: ProvenanceColumns): TimelineProvenance {
  return {
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    anchorId: row.anchorId,
    confidence: row.confidence,
    confirmationState: row.confirmationState,
  };
}

/** A document has no provenance columns: it came from its capture, or was added by hand. */
function documentProvenance(row: DocumentRow): TimelineProvenance {
  return {
    sourceType: row.sourceCaptureId === null ? 'manual' : 'capture',
    sourceRef: row.sourceCaptureId,
    anchorId: null,
    confidence: null,
    confirmationState: 'confirmed',
  };
}

/** The base of an event dated by a court day. */
function onDay(
  id: string,
  matterId: string,
  proceedingId: string | null,
  day: string,
  row: ProvenanceColumns,
) {
  return {
    id,
    matterId,
    proceedingId,
    date: day,
    at: dayStart(day),
    provenance: provenanceOf(row),
    anchorId: row.anchorId,
  };
}

/** The base of an event dated by an instant. */
function atInstant(
  id: string,
  matterId: string,
  proceedingId: string | null,
  at: Date,
  provenance: TimelineProvenance,
) {
  return {
    id,
    matterId,
    proceedingId,
    date: COURT_DAY.format(at),
    at: at.toISOString(),
    provenance,
    anchorId: provenance.anchorId,
  };
}

function compareEvents(a: TimelineEvent, b: TimelineEvent): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (rank !== 0) return rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The matter's timeline across its proceedings, oldest first, optionally bounded to court days
 * `from`..`to` (inclusive) and to `kinds`. Needs `matter.read`; NOT_FOUND for a matter outside the
 * actor's workspace or one the actor may not read. Reads only.
 */
export async function getMatterTimeline(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: GetMatterTimelineInput,
): Promise<TimelineEvent[]> {
  const data = parseInput(GetMatterTimelineInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId } = scope.actor;
    const owning = await requireMatter(scope, data.matterId, 'matter.read');
    const matterId = owning.id;
    const filter: TimelineFilter = {
      from: data.from,
      to: data.to,
      kinds: new Set(data.kinds ?? TIMELINE_EVENT_KINDS),
    };
    const proceedingIds = (await proceedingKeys(tx, workspaceId, matterId)).map((p) => p.id);
    const proceedingOfListing = new Map<string, string>();
    if (filter.kinds.has('hearing') && proceedingIds.length > 0) {
      for (const row of await listingKeys(tx, workspaceId, proceedingIds)) {
        proceedingOfListing.set(row.id, row.proceedingId);
      }
    }
    const q = timelineStatements(
      tx,
      workspaceId,
      matterId,
      proceedingIds,
      [...proceedingOfListing.keys()],
      filter,
    );
    const events: TimelineEvent[] = [];
    for (const row of (await q.listing) ?? []) {
      events.push({
        ...onDay(row.id, matterId, row.proceedingId, row.listDate, row),
        kind: 'listing',
        listType: row.listType,
        stageRaw: row.stageRaw,
        stageNorm: row.stageNorm,
        canonical: row.canonical,
        benchId: row.benchId,
        hallId: row.hallId,
        listNo: row.listNo,
        itemNo: row.itemNo,
      });
    }
    for (const row of (await q.hearing) ?? []) {
      events.push({
        ...onDay(row.id, matterId, proceedingOfListing.get(row.listingId) ?? null, row.heldOn, row),
        kind: 'hearing',
        listingId: row.listingId,
        outcome: row.outcome,
        adjournmentReason: row.adjournmentReason,
        nextDateProposed: row.nextDateProposed,
        nextDateConfirmed: row.nextDateConfirmed,
      });
    }
    for (const row of (await q.order) ?? []) {
      events.push({
        ...onDay(row.id, matterId, row.proceedingId, row.orderDate, row),
        kind: 'order',
        documentId: row.documentId,
        orderType: row.orderType,
        benchId: row.benchId,
        nextDate: row.nextDate,
      });
    }
    for (const row of (await q.obligationDue) ?? []) {
      if (row.dueDate === null) continue;
      events.push({
        ...onDay(row.id, matterId, row.proceedingId, row.dueDate, row),
        kind: 'obligation_due',
        obligationId: row.id,
        description: row.description,
        status: row.status,
        source: row.source,
      });
    }
    for (const row of (await q.obligationClosed) ?? []) {
      if (row.closedAt === null) continue;
      events.push({
        ...atInstant(row.id, matterId, row.proceedingId, row.closedAt, provenanceOf(row)),
        kind: 'obligation_closed',
        obligationId: row.id,
        description: row.description,
        status: row.status,
        closedReasonType: row.closedReasonType,
      });
    }
    for (const row of (await q.stateChange) ?? []) {
      events.push({
        ...atInstant(row.id, matterId, row.proceedingId, row.changedAt, provenanceOf(row)),
        kind: 'state_change',
        from: row.fromState,
        to: row.toState,
        reason: row.reason,
        actorMemberId: row.actorMemberId,
        cureDeadline: row.cureDeadline,
      });
    }
    for (const row of (await q.documentAdded) ?? []) {
      events.push({
        ...atInstant(row.id, matterId, null, row.createdAt, documentProvenance(row)),
        kind: 'document_added',
        documentId: row.id,
        documentKind: row.kind,
        supersedesDocumentId: row.supersedesDocumentId,
      });
    }
    return events.sort(compareEvents);
  });
}
