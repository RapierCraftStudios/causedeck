// The import review (#53; PRD CA-5; docs/product/09 §4.2): what a calendar file would do, one row
// per hearing-like event, each confirmed or skipped on its own. There is no bulk confirm for next
// dates. A matched event previews as a next date (or a conflict with the confirmed date); an
// unmatched one can only be attached to a matter as an undated note or skipped, and no matter is
// ever created from a calendar event. Confirming goes through the engine's `acceptProposal`, so the
// date changes only on this explicit action and with the engine's undo.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { acceptProposal, dismissProposal } from '../automation/index.ts';
import { closeReviewedCapture, createManualCapture, type CaptureCtx } from '../capture/index.ts';
import type { GraphEvents, MatterGraphDeps } from '../matter-graph/index.ts';
import { conflict, invalid, notFound } from '../shared/errors.ts';

const { capture, icsImportEvent, proposal } = schema;

const NO_EVENTS: GraphEvents = {
  emit() {
    // The review has no event subscribers.
  },
};

export type ImportPreview =
  | { kind: 'next_date'; date: string }
  | { kind: 'conflict'; date: string }
  | { kind: 'listing_update' }
  | { kind: 'none' };

export interface ImportReviewRow {
  uid: string;
  status: (typeof icsImportEvent.$inferSelect)['status'];
  summary: string;
  location: string | null;
  eventDate: string;
  eventTime: string | null;
  matterId: string | null;
  proceedingId: string | null;
  proposalId: string | null;
  preview: ImportPreview;
}

export interface ImportReview {
  captureId: string;
  /** The capture's status: still reading, needs you, failed. */
  captureStatus: string;
  /** The counts recorded when the file was read; null before the import ran. */
  summary: Record<string, number> | null;
  rows: ImportReviewRow[];
}

export interface ReviewScope {
  db: Database | Transaction;
  workspaceId: string;
  userId: string;
  events?: GraphEvents;
  now?: () => Date;
}

const graphOf = (scope: ReviewScope, tx: ReviewScope['db']): MatterGraphDeps => ({
  db: tx,
  events: scope.events ?? NO_EVENTS,
  ...(scope.now === undefined ? {} : { now: scope.now }),
});

function previewOf(
  row: typeof icsImportEvent.$inferSelect,
  stored:
    | { kind: string; payload: Record<string, unknown>; entityRefs: Record<string, unknown> }
    | undefined,
): ImportPreview {
  if (stored === undefined) return { kind: 'none' };
  if (stored.kind === 'listing_update') return { kind: 'listing_update' };
  if (stored.kind !== 'next_date') return { kind: 'none' };
  const date = typeof stored.payload['date'] === 'string' ? stored.payload['date'] : row.eventDate;
  return stored.entityRefs['conflict'] === true
    ? { kind: 'conflict', date }
    : { kind: 'next_date', date };
}

/** The events of one capture with what each would do. Reads only. */
export async function getImportReview(
  scope: ReviewScope,
  captureId: string,
): Promise<ImportReview> {
  return withWorkspace(
    scope.db,
    { workspaceId: scope.workspaceId, userId: scope.userId },
    async (tx) => {
      const [cap] = await tx
        .select({
          channel: capture.channel,
          status: capture.status,
          sourceMeta: capture.sourceMeta,
        })
        .from(capture)
        .where(and(eq(capture.workspaceId, scope.workspaceId), eq(capture.id, captureId)));
      if (cap === undefined || cap.channel !== 'ics') throw notFound('Capture not found');
      const events = await tx
        .select()
        .from(icsImportEvent)
        .where(
          and(
            eq(icsImportEvent.workspaceId, scope.workspaceId),
            eq(icsImportEvent.captureId, captureId),
          ),
        )
        .orderBy(asc(icsImportEvent.eventDate), asc(icsImportEvent.uid));
      const ids = events.flatMap((e) => (e.proposalId === null ? [] : [e.proposalId]));
      const proposals =
        ids.length === 0
          ? []
          : await tx
              .select({
                id: proposal.id,
                kind: proposal.kind,
                payload: proposal.payload,
                entityRefs: proposal.entityRefs,
              })
              .from(proposal)
              .where(and(eq(proposal.workspaceId, scope.workspaceId), inArray(proposal.id, ids)));
      const byId = new Map(proposals.map((p) => [p.id, p]));
      const raw = cap.sourceMeta['icsImport'];
      return {
        captureId,
        captureStatus: cap.status,
        summary: typeof raw === 'object' && raw !== null ? (raw as Record<string, number>) : null,
        rows: events.map((row) => ({
          uid: row.uid,
          status: row.status,
          summary: row.summary,
          location: row.location,
          eventDate: row.eventDate,
          eventTime: row.eventTime,
          matterId: row.matterId,
          proceedingId: row.proceedingId,
          proposalId: row.proposalId,
          preview: previewOf(row, row.proposalId === null ? undefined : byId.get(row.proposalId)),
        })),
      };
    },
  );
}

async function loadRow(tx: ReviewScope['db'], workspaceId: string, captureId: string, uid: string) {
  const [row] = await tx
    .select()
    .from(icsImportEvent)
    .where(
      and(
        eq(icsImportEvent.workspaceId, workspaceId),
        eq(icsImportEvent.captureId, captureId),
        eq(icsImportEvent.uid, uid),
      ),
    )
    .for('update');
  if (row === undefined) throw notFound('Event not found');
  return row;
}

async function setStatus(
  tx: ReviewScope['db'],
  scope: ReviewScope,
  captureId: string,
  uid: string,
  status: ImportReviewRow['status'],
): Promise<void> {
  const now = scope.now?.() ?? new Date();
  await tx
    .update(icsImportEvent)
    .set({ status, updatedAt: now })
    .where(
      and(
        eq(icsImportEvent.workspaceId, scope.workspaceId),
        eq(icsImportEvent.captureId, captureId),
        eq(icsImportEvent.uid, uid),
      ),
    );
  const open = await tx
    .select({ uid: icsImportEvent.uid })
    .from(icsImportEvent)
    .where(
      and(
        eq(icsImportEvent.workspaceId, scope.workspaceId),
        eq(icsImportEvent.captureId, captureId),
        inArray(icsImportEvent.status, ['proposed', 'unmatched']),
      ),
    )
    .limit(1);
  if (open.length === 0) await closeReviewedCapture(tx, scope.workspaceId, captureId, now);
}

/** Confirm one matched event: the engine applies its proposal (a next date, with undo). */
export async function confirmImportEvent(
  scope: ReviewScope,
  input: { captureId: string; uid: string },
): Promise<void> {
  await withWorkspace(
    scope.db,
    { workspaceId: scope.workspaceId, userId: scope.userId },
    async (tx) => {
      const row = await loadRow(tx, scope.workspaceId, input.captureId, input.uid);
      if (row.status !== 'proposed' || row.proposalId === null) {
        throw conflict('This event has nothing to confirm');
      }
      await acceptProposal(
        graphOf(scope, tx),
        { workspaceId: scope.workspaceId, userId: scope.userId },
        {
          proposalId: row.proposalId,
        },
      );
      await setStatus(tx, scope, input.captureId, input.uid, 'applied');
    },
  );
}

/** Skip one event: its open proposal is dismissed (never proposed again) and nothing else changes. */
export async function skipImportEvent(
  scope: ReviewScope,
  input: { captureId: string; uid: string },
): Promise<void> {
  await withWorkspace(
    scope.db,
    { workspaceId: scope.workspaceId, userId: scope.userId },
    async (tx) => {
      const row = await loadRow(tx, scope.workspaceId, input.captureId, input.uid);
      if (row.status !== 'proposed' && row.status !== 'unmatched') {
        throw conflict('This event is already settled');
      }
      if (row.proposalId !== null) {
        await dismissProposal(
          graphOf(scope, tx),
          { workspaceId: scope.workspaceId, userId: scope.userId },
          {
            proposalId: row.proposalId,
            reason: 'Skipped from the calendar import',
          },
        );
      }
      await setStatus(tx, scope, input.captureId, input.uid, 'skipped');
    },
  );
}

/**
 * Attach an unmatched event to a matter as an undated note (a manual capture hinted at the matter).
 * No date, listing or matter is created.
 */
export async function attachImportEventAsNote(
  scope: ReviewScope,
  ctx: CaptureCtx,
  input: { captureId: string; uid: string; matterId: string },
): Promise<void> {
  await withWorkspace(
    scope.db,
    { workspaceId: scope.workspaceId, userId: scope.userId },
    async (tx) => {
      const row = await loadRow(tx, scope.workspaceId, input.captureId, input.uid);
      if (row.status !== 'unmatched')
        throw invalid('Only an unmatched event can be attached as a note');
      const lines = [
        `Calendar event: ${row.summary}`,
        row.location === null ? null : `Place: ${row.location}`,
        'Imported from a calendar file as a note. It does not set a hearing date.',
      ].filter((line): line is string => line !== null);
      await createManualCapture(
        { ...ctx, db: tx },
        { text: lines.join('\n'), matterHintId: input.matterId },
      );
      await setStatus(tx, scope, input.captureId, input.uid, 'noted');
    },
  );
}
