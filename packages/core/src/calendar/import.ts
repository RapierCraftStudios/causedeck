// The ICS import (#53; PRD CA-5; docs/product/09 §2.5 O8, §3): the `capture.process` body for
// `channel = ics`. It parses the file, keeps only hearing-like events (everything else is counted
// and dropped, never stored; sensitive-looking personal events and events of sensitive matters are
// dropped too), matches each to a proceeding of the importer's workspace by case number, and hands
// the engine `next_date` drafts (the engine stages a proposal, or a conflict card when the day
// differs from a confirmed date; an import never confirms or overwrites anything). Each matched
// event carries a `calendar_event` anchor: a one-event .ics stored as a document of the matched
// matter, so the other entries of a diary file never reach another matter. The ledger
// (`ics_import_event`) makes a re-import idempotent: only a higher SEQUENCE of a known UID is
// processed again, and it supersedes that event's earlier open proposal.
import { can, isRole } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import {
  classifyEvent,
  eventToDraft,
  parseIcs,
  type CaseCandidate,
  type IcsEvent,
  type MatchedTarget,
} from '@causedeck/capture';
import { serverEnv } from '@causedeck/config/env';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { createObjectStoreFromEnv, objectKey, type ObjectStore } from '@causedeck/storage';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';

import { dismissProposal, submitProposals } from '../automation/index.ts';
import { finishCapture } from '../capture/index.ts';
import {
  createDocument,
  getCanonicalNextDate,
  normaliseCaseType,
  type GraphEvents,
  type MatterGraphDeps,
} from '../matter-graph/index.ts';
import { forbidden } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

const { anchor, blob, capture, icsImportEvent, matter, member, proceeding } = schema;

const QUOTE_MAX = schema.ANCHOR_QUOTE_MAX;
/** More events than this in one file are not read (the rest are counted as ignored). */
const MAX_EVENTS = 5000;
const NO_EVENTS: GraphEvents = {
  emit() {
    // The import has no event subscribers.
  },
};

export interface IcsImportDeps {
  db: Database | Transaction;
  store?: ObjectStore;
  events?: GraphEvents;
  now?: () => Date;
}

/** What a file did, for the capture result ("3 new, 2 changed, 10 unchanged"). Counts only. */
export interface IcsImportSummary {
  new: number;
  changed: number;
  unchanged: number;
  /** Not hearing-like, cancelled, past, personal or of a sensitive matter: counted, never stored. */
  ignored: number;
  /** Hearing-like but not matched to one proceeding: listed for review. */
  unmatched: number;
  diagnostics: number;
}

export type IcsImportOutcome =
  | { outcome: 'missing' }
  | { outcome: 'skipped' }
  | { outcome: 'failed' }
  | { outcome: 'imported'; summary: IcsImportSummary };

const istDay = (at: Date): string =>
  new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** A one-event calendar: the evidence behind a proposal, with nothing else from the file. */
function evidenceIcs(event: IcsEvent): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CauseDeck//Import evidence//EN',
    event.raw.trim(),
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function anchorQuote(event: IcsEvent): string {
  const head = `UID:${event.uid}\r\nDTSTAMP:${event.dtstamp ?? ''}\r\n`;
  return `${head}${event.raw}`.slice(0, QUOTE_MAX);
}

interface Found {
  proceedingId: string;
  matterId: string;
  sensitive: boolean;
}

async function findProceedings(
  tx: Transaction,
  actor: { userId: string; workspaceId: string; role: Parameters<typeof can>[0]['role'] },
  settings: ReturnType<typeof toPolicySettings>,
  candidates: readonly CaseCandidate[],
): Promise<Found[]> {
  const found = new Map<string, Found>();
  const lookup = async (candidate: CaseCandidate, typed: boolean) =>
    tx
      .select({
        proceedingId: proceeding.id,
        matterId: proceeding.matterId,
        sensitive: matter.sensitive,
      })
      .from(proceeding)
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
      )
      .leftJoin(
        member,
        and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
      )
      .where(
        and(
          eq(proceeding.workspaceId, actor.workspaceId),
          eq(proceeding.number, candidate.number),
          eq(proceeding.year, candidate.year),
          typed && candidate.caseType !== null
            ? eq(proceeding.caseTypeCode, normaliseCaseType(candidate.caseType))
            : sql`true`,
          matterVisibilityPredicate(actor, matter.id, { settings, ownerUserId: member.userId }),
        ),
      )
      .limit(3);
  for (const candidate of candidates) {
    // The printed type is a guess from the words before the number: when it finds nothing, the
    // number and year alone may still name exactly one proceeding (more than one is ambiguous).
    let rows = await lookup(candidate, true);
    if (rows.length === 0 && candidate.caseType !== null) rows = await lookup(candidate, false);
    for (const row of rows) found.set(row.proceedingId, row);
  }
  return [...found.values()];
}

/** Store the event's own .ics as a document of the matter and anchor it (`calendar_event`). */
async function recordEvidence(
  deps: { store: ObjectStore; graph: MatterGraphDeps; now: Date },
  tx: Transaction,
  actor: { userId: string; workspaceId: string },
  matterId: string,
  event: IcsEvent,
): Promise<string> {
  const body = Buffer.from(evidenceIcs(event), 'utf8');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const blobId = randomUUID();
  const key = objectKey({ workspaceId: actor.workspaceId, kind: 'document', id: blobId }, deps.now);
  await deps.store.put({ key, body, contentType: 'text/calendar' });
  await tx.insert(blob).values({
    id: blobId,
    workspaceId: actor.workspaceId,
    key,
    kind: 'document',
    filename: 'event.ics',
    size: body.byteLength,
    sha256,
    mime: 'text/calendar',
    scanStatus: 'skipped',
    createdBy: actor.userId,
    createdAt: deps.now,
    finalizedAt: deps.now,
  });
  const document = await createDocument(deps.graph, actor, {
    matterId,
    kind: 'other',
    storageKey: key,
    sha256,
  });
  const [row] = await tx
    .insert(anchor)
    .values({
      workspaceId: actor.workspaceId,
      documentId: document.id,
      pageNo: 1,
      quote: anchorQuote(event),
      kind: 'calendar_event',
    })
    .returning({ id: anchor.id });
  if (row === undefined) throw new Error('anchor insert returned no row');
  return row.id;
}

export async function runIcsImport(
  deps: IcsImportDeps,
  payload: { workspaceId: string; captureId: string },
): Promise<IcsImportOutcome> {
  const { workspaceId, captureId } = payload;
  const now = deps.now?.() ?? new Date();
  return withWorkspace(deps.db, { workspaceId }, async (tx): Promise<IcsImportOutcome> => {
    const [row] = await tx
      .select()
      .from(capture)
      .where(and(eq(capture.id, captureId), eq(capture.workspaceId, workspaceId)))
      .for('update');
    if (row === undefined) return { outcome: 'missing' };
    if (row.status !== 'processing' || row.channel !== 'ics') return { outcome: 'skipped' };
    const userId = row.createdBy;
    const key = row.rawStorageKey;
    if (userId === null || key === null) {
      await finishCapture(tx, row, 'failed', {}, now, 'processing_failed');
      return { outcome: 'failed' };
    }
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw forbidden('The importer is no longer a member');
    const actor = { userId, workspaceId, role };
    if (!can(actor, 'matter.write').allow) throw forbidden('You cannot import a calendar');
    const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
    const store = deps.store ?? createObjectStoreFromEnv(serverEnv());
    const graph: MatterGraphDeps = {
      db: tx,
      events: deps.events ?? NO_EVENTS,
      settings,
      now: () => now,
    };
    const graphActor = { workspaceId, userId };

    const object = await store.get(key as Parameters<ObjectStore['get']>[0]);
    const parsed = parseIcs(Buffer.from(object.body).toString('utf8'), { now });
    const summary: IcsImportSummary = {
      new: 0,
      changed: 0,
      unchanged: 0,
      ignored: 0,
      unmatched: 0,
      diagnostics: parsed.diagnostics.length,
    };
    if (parsed.events.length === 0 && parsed.diagnostics.some((d) => d.level === 'error')) {
      await finishCapture(tx, row, 'failed', { icsImport: summary }, now, 'processing_failed');
      return { outcome: 'failed' };
    }

    const today = istDay(now);
    interface Pending {
      event: IcsEvent;
      score: number;
      matched: Found | null;
      earlierProposalId: string | null;
      draftIndex: number | null;
      status: 'proposed' | 'unmatched' | 'unchanged' | 'skipped';
      anchorId: string | null;
    }
    const pending: Pending[] = [];
    const drafts: unknown[] = [];
    const events = parsed.events.slice(0, MAX_EVENTS);
    summary.ignored += parsed.events.length - events.length;
    const earlier =
      events.length === 0
        ? []
        : await tx
            .select()
            .from(icsImportEvent)
            .where(
              and(
                eq(icsImportEvent.workspaceId, workspaceId),
                inArray(
                  icsImportEvent.uid,
                  events.map((e) => e.instanceKey),
                ),
              ),
            );
    const known = new Map(earlier.map((e) => [e.uid, e]));

    for (const event of events) {
      const verdict = classifyEvent(event);
      if (!verdict.hearingLike || verdict.sensitive || event.status === 'cancelled') {
        summary.ignored += 1;
        continue;
      }
      const before = known.get(event.instanceKey);
      if (before !== undefined && event.sequence <= before.sequence) {
        summary.unchanged += 1;
        continue;
      }
      const matches = await findProceedings(tx, actor, settings, verdict.candidates);
      const only = matches.length === 1 ? (matches[0] ?? null) : null;
      if (only?.sensitive === true) {
        summary.ignored += 1;
        continue;
      }
      const item: Pending = {
        event,
        score: verdict.score,
        matched: only,
        earlierProposalId: before?.proposalId ?? null,
        draftIndex: null,
        status: 'unmatched',
        anchorId: null,
      };
      if (only === null) {
        summary.unmatched += 1;
        pending.push(item);
        continue;
      }
      const current = await getCanonicalNextDate(graph, graphActor, {
        proceedingId: only.proceedingId,
      });
      const target: MatchedTarget = {
        proceedingId: only.proceedingId,
        matterId: only.matterId,
        confirmedDate:
          current !== null && current.confirmationState !== 'proposed' ? current.listDate : null,
        confirmedListingId:
          current !== null && current.confirmationState !== 'proposed' ? current.id : null,
      };
      const probe = eventToDraft(event, target, {
        captureId,
        today,
        anchorIds: [],
        score: verdict.score,
      });
      if (probe.kind === 'ignored') {
        summary.ignored += 1;
        continue;
      }
      if (probe.kind === 'unchanged') {
        item.status = 'unchanged';
        summary.unchanged += 1;
        pending.push(item);
        continue;
      }
      const anchorId = await recordEvidence(
        { store, graph, now },
        tx,
        graphActor,
        only.matterId,
        event,
      );
      const withAnchor = eventToDraft(event, target, {
        captureId,
        today,
        anchorIds: [anchorId],
        score: verdict.score,
      });
      if (withAnchor.kind !== 'draft') continue;
      item.anchorId = anchorId;
      item.draftIndex = drafts.length;
      item.status = 'proposed';
      drafts.push(withAnchor.draft);
      summary[before === undefined ? 'new' : 'changed'] += 1;
      pending.push(item);
    }

    // A changed event replaces its earlier open proposal: dismiss it before staging the new one.
    for (const item of pending) {
      if (item.draftIndex === null || item.earlierProposalId === null) continue;
      const [open] = await tx
        .select({ status: schema.proposal.status })
        .from(schema.proposal)
        .where(
          and(
            eq(schema.proposal.workspaceId, workspaceId),
            eq(schema.proposal.id, item.earlierProposalId),
          ),
        );
      if (open?.status === 'proposed') {
        await dismissProposal(graph, graphActor, {
          proposalId: item.earlierProposalId,
          reason: 'Replaced by a newer version of the calendar event',
        });
      }
    }
    const submitted =
      drafts.length === 0 ? { items: [] } : await submitProposals(graph, graphActor, drafts);

    for (const item of pending) {
      const result = item.draftIndex === null ? undefined : submitted.items[item.draftIndex];
      let status = item.status;
      if (result !== undefined) {
        status =
          result.status === 'refused'
            ? 'skipped'
            : result.status === 'superseded' || result.status === 'duplicate'
              ? 'unchanged'
              : 'proposed';
      }
      const values = {
        workspaceId,
        uid: item.event.instanceKey,
        sequence: item.event.sequence,
        captureId,
        proposalId: result?.proposalId ?? null,
        anchorId: item.anchorId,
        matterId: item.matched?.matterId ?? null,
        proceedingId: item.matched?.proceedingId ?? null,
        status,
        summary: item.event.summary.slice(0, 500),
        location: item.event.location === '' ? null : item.event.location.slice(0, 300),
        eventDate: item.event.date,
        eventTime: item.event.time,
        score: item.score.toFixed(3),
        updatedAt: now,
      };
      await tx
        .insert(icsImportEvent)
        .values(values)
        .onConflictDoUpdate({
          target: [icsImportEvent.workspaceId, icsImportEvent.uid],
          set: {
            sequence: values.sequence,
            captureId,
            proposalId: values.proposalId,
            anchorId: values.anchorId,
            matterId: values.matterId,
            proceedingId: values.proceedingId,
            status,
            summary: values.summary,
            location: values.location,
            eventDate: values.eventDate,
            eventTime: values.eventTime,
            score: values.score,
            updatedAt: now,
          },
        });
    }

    const needsYou = pending.some((p) => p.status === 'proposed' || p.status === 'unmatched');
    await finishCapture(tx, row, needsYou ? 'needs_you' : 'ready', { icsImport: summary }, now);
    return { outcome: 'imported', summary };
  });
}

/** "3 new, 2 changed, 10 unchanged": the plain sentence for the capture result. */
export function describeImport(
  summary: Pick<IcsImportSummary, 'new' | 'changed' | 'unchanged'>,
): string {
  return `${String(summary.new)} new, ${String(summary.changed)} changed, ${String(summary.unchanged)} unchanged`;
}
