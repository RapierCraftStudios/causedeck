// Diary-photo structuring (#52), run inside the pipeline's persisting transaction for a `camera`
// capture: the document's OCR lines go to the `structure_diary` task (never for an `ai_blocked`
// capture), each verified entry is anchored to its line box (`image_region`) and staged as a
// proposal draft. A case reference attaches only to a proceeding with the same number and year;
// nothing else is attached. A page that reads poorly makes the capture `unreadable` (Needs you).
import type { AiGateway } from '@causedeck/ai';
import { can, isRole } from '@causedeck/auth/policy';
import { schema, type Queryable } from '@causedeck/db';
import {
  anchorKey,
  anchorRow,
  diaryToProposalDrafts,
  normaliseCaseRef,
  normaliseLines,
  structureDiaryPage,
  type DiaryAnchor,
  type DiaryPage,
  type DiaryProceeding,
  type FinishedOutcome,
} from '@causedeck/intelligence';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { createCoreAiGateway } from '../ai/index.ts';
import { submitProposals } from '../automation/index.ts';
import type { GraphEvents, MatterGraphDeps } from '../matter-graph/index.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import type { CaptureRecord } from './state.ts';

const { anchor, documentPage, proceeding } = schema;

const NO_EVENTS: GraphEvents = {
  emit() {
    // Diary structuring has no event subscribers.
  },
};

export interface DiaryStepDeps {
  /** Defaults to the core gateway over the transaction. */
  gateway?: AiGateway;
  events?: GraphEvents;
  now: Date;
  pipelineVersion: string;
}

/** What the step found; written to the capture's `source_meta.diary` (counts, never content). */
export interface DiarySummary {
  status: 'structured' | 'unreadable' | 'skipped';
  entries: number;
  proposals: number;
}

export interface DiaryStepResult {
  outcome: FinishedOutcome;
  summary: DiarySummary | null;
}

/** Whether the diary step applies to a finished camera capture. */
export function diaryStepApplies(row: CaptureRecord, finished: FinishedOutcome): boolean {
  return (
    row.channel === 'camera' &&
    finished.created &&
    finished.documentId !== null &&
    finished.route == null &&
    finished.status === 'ready' &&
    finished.textStatus !== 'failed'
  );
}

export async function runDiaryStep(
  tx: Queryable,
  row: CaptureRecord,
  finished: FinishedOutcome,
  deps: DiaryStepDeps,
): Promise<DiaryStepResult> {
  const documentId = finished.documentId;
  if (!diaryStepApplies(row, finished) || documentId === null) {
    return { outcome: finished, summary: null };
  }
  // Read from the row, never from a payload: a sensitive matter hint is never bypassed.
  if (row.aiBlocked) {
    return { outcome: finished, summary: { status: 'skipped', entries: 0, proposals: 0 } };
  }
  const { workspaceId } = row;
  const pageRows = await tx
    .select({
      pageNo: documentPage.pageNo,
      text: documentPage.text,
      confidence: documentPage.ocrConfidence,
      lines: documentPage.ocrLines,
    })
    .from(documentPage)
    .where(and(eq(documentPage.workspaceId, workspaceId), eq(documentPage.documentId, documentId)))
    .orderBy(asc(documentPage.pageNo));
  const pages: DiaryPage[] = pageRows.map((page) => ({
    page: page.pageNo,
    text: page.text ?? '',
    confidence: page.confidence === null ? null : Number(page.confidence),
    lines: normaliseLines(page.lines ?? undefined),
  }));

  const gateway = deps.gateway ?? createCoreAiGateway(tx, { now: () => deps.now });
  const result = await structureDiaryPage(
    {
      gateway,
      scope: {
        workspaceId,
        captureId: row.id,
        ...(row.matterHintId === null ? {} : { matterId: row.matterHintId }),
        ...(row.createdBy === null ? {} : { userId: row.createdBy }),
      },
      pipelineVersion: deps.pipelineVersion,
    },
    { pages, aiBlocked: false },
  );
  if (result.status === 'skipped') {
    return { outcome: finished, summary: { status: 'skipped', entries: 0, proposals: 0 } };
  }
  if (result.status === 'unreadable') {
    return {
      outcome: { ...finished, status: 'needs_you', reason: 'unreadable' },
      summary: { status: 'unreadable', entries: 0, proposals: 0 },
    };
  }
  const entries = result.result.entries;
  if (entries.length === 0 || row.createdBy === null) {
    return { outcome: finished, summary: { status: 'structured', entries: 0, proposals: 0 } };
  }

  const userId = row.createdBy;
  const role = await memberRole(tx, userId, workspaceId);
  if (role === null || !isRole(role)) {
    return {
      outcome: finished,
      summary: { status: 'skipped', entries: entries.length, proposals: 0 },
    };
  }
  const actor = { userId, workspaceId, role };
  if (!can(actor, 'matter.write').allow) {
    return {
      outcome: finished,
      summary: { status: 'skipped', entries: entries.length, proposals: 0 },
    };
  }

  // Anchors first: one `image_region` row per distinct line box cited.
  const anchors = new Map<string, DiaryAnchor>();
  for (const entry of entries) {
    anchors.set(anchorKey(entry.anchor), entry.anchor);
    if (entry.nextDate !== undefined)
      anchors.set(anchorKey(entry.nextDate.anchor), entry.nextDate.anchor);
  }
  const anchorIds = new Map<string, string>();
  for (const [key, value] of anchors) {
    const [created] = await tx
      .insert(anchor)
      .values({ workspaceId, documentId, ...anchorRow(value) })
      .returning({ id: anchor.id });
    if (created === undefined) throw new Error('anchor insert returned no row');
    anchorIds.set(key, created.id);
  }

  const refs = entries
    .map((entry) => normaliseCaseRef(entry.caseRef ?? ''))
    .filter((ref): ref is NonNullable<typeof ref> => ref !== null);
  const numbers = [...new Set(refs.map((ref) => ref.number))];
  const candidates =
    numbers.length === 0
      ? []
      : await tx
          .select({
            id: proceeding.id,
            matterId: proceeding.matterId,
            number: proceeding.number,
            year: proceeding.year,
          })
          .from(proceeding)
          .where(and(eq(proceeding.workspaceId, workspaceId), inArray(proceeding.number, numbers)));
  const proceedings: DiaryProceeding[] = candidates.flatMap((p) =>
    p.number === null || p.year === null
      ? []
      : [{ proceedingId: p.id, matterId: p.matterId, number: p.number, year: p.year }],
  );

  const drafts = diaryToProposalDrafts(result.result, {
    captureId: row.id,
    aiCallId: result.aiCallId,
    proceedings,
    anchorIds,
  });
  const graph: MatterGraphDeps = {
    db: tx,
    events: deps.events ?? NO_EVENTS,
    settings: toPolicySettings(await getRoleSettings(tx, workspaceId)),
    now: () => deps.now,
  };
  const submitted =
    drafts.length === 0
      ? { items: [] }
      : await submitProposals(graph, { userId, workspaceId }, drafts);
  const proposals = submitted.items.filter((item) => item.status !== 'refused').length;
  return {
    outcome: proposals > 0 ? { ...finished, status: 'needs_you' } : finished,
    summary: { status: 'structured', entries: entries.length, proposals },
  };
}
