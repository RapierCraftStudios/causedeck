// The capture inbox read model (#48): `getInbox` groups what needs the person (open proposals,
// conflicts, unreadable captures) and what is in flight (captures still being processed) in one
// pass, with the counts the segmented control shows. "Ready to send" is not read here: outward
// drafts arrive through the web app's provider registry (#69). The query runs in the actor's
// workspace scope, hides matters the actor may not read (`matterVisibilityPredicate`), hides
// memory proposals from members without `strategy.read`, and never returns AI-derived content of a
// sensitive matter (only the fact that something is waiting, with a lock).
import { can } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import { schema } from '@causedeck/db';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { GraphActor, MatterGraphDeps } from '../matter-graph/index.ts';

import { inAutomationScope } from './context.ts';
import { UNDO_WINDOW_DAYS } from './levels.ts';

const { activity, anchor, capture, listing, matter, proceeding, proposal } = schema;

/** Captures in these statuses are still being worked on. */
export const PROCESSING_STATUSES = ['received', 'scanning', 'queued', 'processing'] as const;
/** A capture the system could not read: it waits for the person's recovery choice. */
export const UNREADABLE_STATUSES = ['needs_you', 'failed'] as const;

const DAY_MS = 86_400_000;
const INBOX_LIMIT = 500;

export type InboxItemType = 'proposal' | 'conflict' | 'unreadable';

export interface InboxAnchor {
  id: string;
  documentId: string;
  page: number;
  quote: string;
  highlight: { start: number; end: number } | null;
}

export interface InboxItem {
  /** The proposal id, or the capture id for an unreadable capture. */
  id: string;
  type: InboxItemType;
  /** The proposal kind; null for an unreadable capture. */
  kind: string | null;
  proposalId: string | null;
  captureId: string | null;
  matterId: string | null;
  matterTitle: string | null;
  proceedingId: string | null;
  caseNumber: string | null;
  /** True: the matter is sensitive; `payload` and `anchors` are withheld. */
  sensitive: boolean;
  payload: Record<string, unknown> | null;
  /** Conflict only: the confirmed date the proposal disagrees with. */
  currentDate: string | null;
  confidence: number | null;
  needsYouReason: string | null;
  anchors: InboxAnchor[];
  createdAt: Date;
  /** The wrong-match recovery window closes at this time; null when there is nothing to move. */
  reassignUntil: Date | null;
  /** Unreadable only: "keep as attachment" is a legal move from the capture's status. */
  canKeep: boolean;
}

export interface CaptureProgress {
  captureId: string;
  channel: string;
  status: (typeof PROCESSING_STATUSES)[number];
  createdAt: Date;
}

export interface InboxCounts {
  needsYou: number;
  ready: number;
  processing: number;
}

export interface Inbox {
  needsYou: InboxItem[];
  /** Always empty here: the web app fills it from the registered providers. */
  ready: never[];
  processing: CaptureProgress[];
  counts: InboxCounts;
  /** The member may confirm, edit and dismiss (`matter.write`); false is read-only. */
  canAct: boolean;
}

interface ProposalInput {
  id: string;
  kind: string;
  captureId: string | null;
  matterId: string | null;
  proceedingId: string | null;
  payload: Record<string, unknown>;
  anchors: unknown[];
  confidence: string | null;
  needsYouReason: string | null;
  entityRefs: Record<string, unknown>;
  createdAt: Date;
}

interface CaptureInput {
  id: string;
  channel: string;
  status: string;
  matterHintId: string | null;
  createdAt: Date;
  /** A camera capture routed away from structuring (`cause_list`, `receipt`; #52). */
  route?: string | null;
}

export interface InboxFacts {
  now: Date;
  proposals: ProposalInput[];
  captures: CaptureInput[];
  matters: Map<string, { title: string; sensitive: boolean }>;
  caseNumbers: Map<string, string>;
  anchors: Map<string, InboxAnchor>;
  currentDates: Map<string, string>;
  /** The latest undo deadline of the capture's activities, by capture id. */
  undoUntil: Map<string, Date>;
  /** Capture ids that still have an open proposal. */
  withOpenProposal: Set<string>;
  canWrite: boolean;
  canStrategy: boolean;
}

const isProcessing = (status: string): status is CaptureProgress['status'] =>
  (PROCESSING_STATUSES as readonly string[]).includes(status);

function conflictOf(row: ProposalInput): boolean {
  return row.kind === 'next_date' && row.entityRefs['conflict'] === true;
}

function anchorIds(anchors: unknown[]): string[] {
  return anchors.filter((a): a is string => typeof a === 'string');
}

/** Group the loaded rows into the inbox. Pure: the unit tests drive it without a database. */
export function groupInbox(facts: InboxFacts): Inbox {
  const items: InboxItem[] = [];
  for (const row of facts.proposals) {
    if (row.kind === 'memory_item' && !facts.canStrategy) continue;
    // A matter the member may not read (restricted) hides its proposals too.
    if (row.matterId !== null && !facts.matters.has(row.matterId)) continue;
    const found = row.matterId === null ? undefined : facts.matters.get(row.matterId);
    const sensitive = found?.sensitive ?? false;
    const conflicted = conflictOf(row);
    const currentListing = row.entityRefs['currentListingId'];
    const hasCapture = row.captureId !== null && row.matterId !== null;
    items.push({
      id: row.id,
      type: conflicted ? 'conflict' : 'proposal',
      kind: row.kind,
      proposalId: row.id,
      captureId: row.captureId,
      matterId: row.matterId,
      matterTitle: found?.title ?? null,
      proceedingId: row.proceedingId,
      caseNumber:
        row.proceedingId === null ? null : (facts.caseNumbers.get(row.proceedingId) ?? null),
      sensitive,
      payload: sensitive ? null : row.payload,
      currentDate:
        !sensitive && typeof currentListing === 'string'
          ? (facts.currentDates.get(currentListing) ?? null)
          : null,
      confidence: row.confidence === null ? null : Number(row.confidence),
      needsYouReason: row.needsYouReason,
      anchors: sensitive
        ? []
        : anchorIds(row.anchors).flatMap((id) => {
            const hit = facts.anchors.get(id);
            return hit === undefined ? [] : [hit];
          }),
      createdAt: row.createdAt,
      reassignUntil: hasCapture ? reassignUntil(facts, row) : null,
      canKeep: false,
    });
  }
  for (const row of facts.captures) {
    if (isProcessing(row.status) || facts.withOpenProposal.has(row.id)) continue;
    items.push({
      id: row.id,
      type: 'unreadable',
      kind: null,
      proposalId: null,
      captureId: row.id,
      matterId: null,
      matterTitle: null,
      proceedingId: null,
      caseNumber: null,
      sensitive: false,
      payload: null,
      currentDate: null,
      confidence: null,
      needsYouReason:
        row.route === 'cause_list' || row.route === 'receipt' ? row.route : 'unreadable',
      anchors: [],
      createdAt: row.createdAt,
      reassignUntil: null,
      canKeep: row.status === 'needs_you',
    });
  }
  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const processing = facts.captures
    .filter((row): row is CaptureInput & { status: CaptureProgress['status'] } =>
      isProcessing(row.status),
    )
    .map((row) => ({
      captureId: row.id,
      channel: row.channel,
      status: row.status,
      createdAt: row.createdAt,
    }));
  return {
    needsYou: items,
    ready: [],
    processing,
    counts: { needsYou: items.length, ready: 0, processing: processing.length },
    canAct: facts.canWrite,
  };
}

function reassignUntil(facts: InboxFacts, row: ProposalInput): Date | null {
  const until =
    (row.captureId === null ? undefined : facts.undoUntil.get(row.captureId)) ??
    new Date(row.createdAt.getTime() + UNDO_WINDOW_DAYS * DAY_MS);
  return until.getTime() > facts.now.getTime() ? until : null;
}

/** `W.P. 12345 of 2026`, from what the proceeding row prints; null when it has no number yet. */
function caseNumberOf(row: {
  caseTypeRaw: string | null;
  caseTypeCode: string;
  number: string | null;
  year: number | null;
}): string | null {
  if (row.number === null) return null;
  const type = row.caseTypeRaw ?? row.caseTypeCode;
  return row.year === null
    ? `${type} ${row.number}`
    : `${type} ${row.number} of ${String(row.year)}`;
}

const uniq = (ids: unknown[]): string[] => [
  ...new Set(ids.filter((id): id is string => typeof id === 'string')),
];

/** The inbox of the signed-in member: grouped, counted and filtered by what they may see. */
export async function getInbox(
  deps: MatterGraphDeps,
  actor: GraphActor,
  now: Date = new Date(),
): Promise<Inbox> {
  return inAutomationScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId } = scope.actor;
    const canRead = can(scope.member, 'matter.read', undefined, scope.deps.settings).allow;
    const canWrite = can(scope.member, 'matter.write', undefined, scope.deps.settings).allow;
    const canStrategy = can(scope.member, 'strategy.read', undefined, scope.deps.settings).allow;
    const empty = groupInbox({
      now,
      proposals: [],
      captures: [],
      matters: new Map(),
      caseNumbers: new Map(),
      anchors: new Map(),
      currentDates: new Map(),
      undoUntil: new Map(),
      withOpenProposal: new Set(),
      canWrite,
      canStrategy,
    });
    if (!canRead) return empty;

    const proposals = await tx
      .select({
        id: proposal.id,
        kind: proposal.kind,
        captureId: proposal.captureId,
        matterId: proposal.matterId,
        proceedingId: proposal.proceedingId,
        payload: proposal.payload,
        anchors: proposal.anchors,
        confidence: proposal.confidence,
        needsYouReason: proposal.needsYouReason,
        entityRefs: proposal.entityRefs,
        createdAt: proposal.createdAt,
      })
      .from(proposal)
      .where(and(eq(proposal.workspaceId, workspaceId), eq(proposal.status, 'proposed')))
      .orderBy(desc(proposal.createdAt))
      .limit(INBOX_LIMIT);
    const captures = await tx
      .select({
        id: capture.id,
        channel: capture.channel,
        status: capture.status,
        matterHintId: capture.matterHintId,
        createdAt: capture.createdAt,
        sourceMeta: capture.sourceMeta,
      })
      .from(capture)
      .where(
        and(
          eq(capture.workspaceId, workspaceId),
          inArray(capture.status, [...PROCESSING_STATUSES, ...UNREADABLE_STATUSES]),
        ),
      )
      .orderBy(desc(capture.createdAt))
      .limit(INBOX_LIMIT);

    const matterIds = uniq(proposals.map((row) => row.matterId));
    const proceedingIds = uniq(proposals.map((row) => row.proceedingId));
    const anchorList = uniq(proposals.flatMap((row) => anchorIds(row.anchors)));
    const currentIds = uniq(proposals.map((row) => row.entityRefs['currentListingId']));
    const captureIds = uniq(proposals.map((row) => row.captureId));

    const matterRows =
      matterIds.length === 0
        ? []
        : await tx
            .select({ id: matter.id, title: matter.title, sensitive: matter.sensitive })
            .from(matter)
            .where(
              and(
                eq(matter.workspaceId, workspaceId),
                inArray(matter.id, matterIds),
                isNull(matter.mergedIntoMatterId),
                matterVisibilityPredicate(scope.member, matter.id, {
                  settings: scope.deps.settings ?? {},
                }),
              ),
            );
    const proceedingRows =
      proceedingIds.length === 0
        ? []
        : await tx
            .select({
              id: proceeding.id,
              caseTypeRaw: proceeding.caseTypeRaw,
              caseTypeCode: proceeding.caseTypeCode,
              number: proceeding.number,
              year: proceeding.year,
            })
            .from(proceeding)
            .where(
              and(eq(proceeding.workspaceId, workspaceId), inArray(proceeding.id, proceedingIds)),
            );
    const anchorRows =
      anchorList.length === 0
        ? []
        : await tx
            .select({
              id: anchor.id,
              documentId: anchor.documentId,
              page: anchor.pageNo,
              quote: anchor.quote,
              start: anchor.charStart,
              end: anchor.charEnd,
            })
            .from(anchor)
            .where(and(eq(anchor.workspaceId, workspaceId), inArray(anchor.id, anchorList)));
    const listingRows =
      currentIds.length === 0
        ? []
        : await tx
            .select({ id: listing.id, date: sql<string>`${listing.listDate}::text` })
            .from(listing)
            .where(and(eq(listing.workspaceId, workspaceId), inArray(listing.id, currentIds)));
    const activityRows =
      captureIds.length === 0
        ? []
        : await tx
            .select({ captureId: activity.captureId, until: activity.undoExpiresAt })
            .from(activity)
            .where(
              and(
                eq(activity.workspaceId, workspaceId),
                inArray(activity.captureId, captureIds),
                isNull(activity.undoneAt),
              ),
            );

    const undoUntil = new Map<string, Date>();
    for (const row of activityRows) {
      if (row.captureId === null) continue;
      const seen = undoUntil.get(row.captureId);
      if (seen === undefined || seen < row.until) undoUntil.set(row.captureId, row.until);
    }
    return groupInbox({
      now,
      proposals,
      captures: captures.map(({ sourceMeta, ...row }) => ({
        ...row,
        route: typeof sourceMeta['cameraRoute'] === 'string' ? sourceMeta['cameraRoute'] : null,
      })),
      matters: new Map(matterRows.map((row) => [row.id, row])),
      caseNumbers: new Map(
        proceedingRows.flatMap((row) => {
          const label = caseNumberOf(row);
          return label === null ? [] : [[row.id, label] as const];
        }),
      ),
      anchors: new Map(
        anchorRows.map((row) => [
          row.id,
          {
            id: row.id,
            documentId: row.documentId,
            page: row.page,
            quote: row.quote,
            highlight:
              row.start !== null && row.end !== null ? { start: row.start, end: row.end } : null,
          },
        ]),
      ),
      currentDates: new Map(listingRows.map((row) => [row.id, row.date])),
      undoUntil,
      withOpenProposal: new Set(captureIds),
      canWrite,
      canStrategy,
    });
  });
}
