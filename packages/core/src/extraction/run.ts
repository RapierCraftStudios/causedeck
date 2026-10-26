// The `extraction.extract-order` job body (#46): read a processed order or judgment, extract it
// with anchors (`extractOrder` in `@causedeck/intelligence`), store the validated result and what
// was rejected, stage the proposals through the automation engine and, when a date or field needs
// a person, move the capture to "Needs you" with a reason code. Re-extraction supersedes the
// current row and never deletes it. Only a capture that may reach AI and a matter that is not
// sensitive are sent to the gateway; otherwise only the deterministic pre-parse runs and no
// `ai_call` row is written. Nothing is applied here: the engine's matrix decides each draft's level.
import type { AiGateway } from '@causedeck/ai';
import { can, isRole } from '@causedeck/auth/policy';
import { transition } from '@causedeck/capture';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import {
  collectAnchors,
  anchorKey,
  EXTRACTION_PIPELINE_VERSION,
  extractOrder,
  toProposalDrafts,
  type PageText,
} from '@causedeck/intelligence';
import { and, asc, eq } from 'drizzle-orm';

import { createCoreAiGateway } from '../ai/index.ts';
import { submitProposals } from '../automation/index.ts';
import { applyDeadlineRules } from '../deadlines/index.ts';
import type { GraphEvents, MatterGraphDeps } from '../matter-graph/index.ts';
import { forbidden } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

const { anchor, capture, document, documentPage, extraction, forum, matter, proceeding } = schema;

const NO_EVENTS: GraphEvents = {
  emit() {
    // Extraction has no event subscribers.
  },
};

export interface ExtractionDeps {
  db: Database | Transaction;
  /** Defaults to the core gateway over the transaction (mock provider unless configured). */
  gateway?: AiGateway;
  now?: () => Date;
  /** Model budget override (tests). */
  modelBudgetMs?: number;
}

export type ExtractionOutcome =
  | { outcome: 'missing' }
  | { outcome: 'skipped'; reason: 'not_an_order' | 'no_text' }
  | { outcome: 'exists' }
  | {
      outcome: 'extracted';
      extractionId: string;
      deterministicOnly: boolean;
      proposals: number;
      needsYou: string[];
    };

export interface ExtractionPayload {
  workspaceId: string;
  documentId: string;
  pipelineVersion?: string | undefined;
  /** Supersede the current extraction instead of keeping it. */
  reextract?: boolean | undefined;
}

export async function runOrderExtraction(
  deps: ExtractionDeps,
  payload: ExtractionPayload,
): Promise<ExtractionOutcome> {
  const { workspaceId, documentId } = payload;
  const pipelineVersion = payload.pipelineVersion ?? EXTRACTION_PIPELINE_VERSION;
  const now = deps.now?.() ?? new Date();
  return withWorkspace(deps.db, { workspaceId }, async (tx): Promise<ExtractionOutcome> => {
    const [doc] = await tx
      .select()
      .from(document)
      .where(and(eq(document.id, documentId), eq(document.workspaceId, workspaceId)));
    if (doc === undefined) return { outcome: 'missing' };
    if (doc.kind !== 'order' && doc.kind !== 'judgment') {
      return { outcome: 'skipped', reason: 'not_an_order' };
    }
    const [current] = await tx
      .select({ id: extraction.id })
      .from(extraction)
      .where(
        and(
          eq(extraction.workspaceId, workspaceId),
          eq(extraction.documentId, documentId),
          eq(extraction.pipelineVersion, pipelineVersion),
          eq(extraction.status, 'current'),
        ),
      )
      .for('update');
    if (current !== undefined && payload.reextract !== true) return { outcome: 'exists' };

    const pageRows = await tx
      .select({
        pageNo: documentPage.pageNo,
        text: documentPage.text,
        textSource: documentPage.textSource,
      })
      .from(documentPage)
      .where(
        and(eq(documentPage.workspaceId, workspaceId), eq(documentPage.documentId, documentId)),
      )
      .orderBy(asc(documentPage.pageNo));
    const pages: PageText[] = pageRows.map((p) => ({
      pageNo: p.pageNo,
      text: p.text ?? '',
      textSource: p.textSource === 'ocr' ? 'ocr' : p.textSource === 'layer' ? 'layer' : null,
    }));
    if (!pages.some((p) => p.text.trim().length > 0)) {
      return { outcome: 'skipped', reason: 'no_text' };
    }

    const [cap] =
      doc.sourceCaptureId === null
        ? []
        : await tx
            .select()
            .from(capture)
            .where(and(eq(capture.id, doc.sourceCaptureId), eq(capture.workspaceId, workspaceId)))
            .for('update');
    const matterId = doc.matterId ?? cap?.matterHintId ?? null;
    let sensitive = false;
    if (matterId !== null) {
      const [m] = await tx
        .select({ sensitive: matter.sensitive })
        .from(matter)
        .where(and(eq(matter.id, matterId), eq(matter.workspaceId, workspaceId)));
      sensitive = m?.sensitive ?? false;
    }
    const aiAllowed = !sensitive && cap?.aiBlocked !== true;
    const userId = cap?.createdBy ?? null;

    const result = await extractOrder({
      documentId,
      pipelineVersion,
      pages,
      ai: aiAllowed
        ? {
            gateway: deps.gateway ?? createCoreAiGateway(tx, { now: () => now }),
            scope: {
              workspaceId,
              ...(userId === null ? {} : { userId }),
              ...(cap === undefined ? {} : { captureId: cap.id }),
              ...(matterId === null ? {} : { matterId }),
            },
          }
        : null,
      ...(deps.modelBudgetMs === undefined ? {} : { modelBudgetMs: deps.modelBudgetMs }),
    });
    const { extraction: found } = result;
    const needsYou = [...found.needsYou];
    if (result.modelTimedOut && !needsYou.includes('extraction_low_confidence')) {
      needsYou.push('extraction_low_confidence');
    }

    // Supersede, never delete.
    if (current !== undefined) {
      await tx
        .update(extraction)
        .set({ status: 'superseded', supersededAt: now })
        .where(and(eq(extraction.id, current.id), eq(extraction.workspaceId, workspaceId)));
    }
    const [row] = await tx
      .insert(extraction)
      .values({
        workspaceId,
        documentId,
        pipelineVersion,
        status: 'current',
        result: found,
        rejected: found.rejected,
        ambiguous: found.ambiguous,
        suspicious: found.suspicious,
        deterministicOnly: found.deterministicOnly,
        needsYouReason: needsYou[0] ?? null,
        aiCallId: result.aiCallId,
      })
      .returning({ id: extraction.id });
    if (row === undefined) throw new Error('extraction insert returned no row');

    // Anchors first: drafts cite `anchor` rows.
    const anchorIds = new Map<string, string>();
    for (const a of collectAnchors(found)) {
      const [inserted] = await tx
        .insert(anchor)
        .values({
          workspaceId,
          documentId,
          pageNo: a.page,
          quote: a.quote.slice(0, schema.ANCHOR_QUOTE_MAX),
          charStart: a.charStart,
          charEnd: a.charEnd,
          kind: 'document',
        })
        .returning({ id: anchor.id });
      if (inserted === undefined) throw new Error('anchor insert returned no row');
      anchorIds.set(anchorKey(a), inserted.id);
    }

    let proposals = 0;
    if (userId !== null) {
      const role = await memberRole(tx, userId, workspaceId);
      if (
        role !== null &&
        isRole(role) &&
        can({ userId, workspaceId, role }, 'matter.write').allow
      ) {
        let proceedingId: string | null = null;
        if (matterId !== null) {
          const rows = await tx
            .select({ id: proceeding.id })
            .from(proceeding)
            .where(and(eq(proceeding.matterId, matterId), eq(proceeding.workspaceId, workspaceId)))
            .limit(2);
          if (rows.length === 1) proceedingId = rows[0]?.id ?? null;
        }
        // A dated "within" direction rolls past the forum's closed days; the rule goes into its basis.
        let directions = found.directions;
        if (proceedingId !== null) {
          const [forumRow] = await tx
            .select({ code: forum.code })
            .from(proceeding)
            .innerJoin(forum, eq(forum.id, proceeding.forumId))
            .where(and(eq(proceeding.id, proceedingId), eq(proceeding.workspaceId, workspaceId)));
          if (forumRow !== undefined) {
            directions = await applyDeadlineRules(tx, {
              workspaceId,
              forumCode: forumRow.code,
              orderDate: found.orderDate?.date,
              directions,
            });
          }
        }
        const drafts = toProposalDrafts(
          { ...found, directions },
          {
            captureId: cap?.id ?? null,
            matterId,
            proceedingId,
            aiCallId: result.aiCallId,
            anchorIds,
          },
        );
        if (drafts.length > 0) {
          const graph: MatterGraphDeps = {
            db: tx,
            events: NO_EVENTS,
            settings: toPolicySettings(await getRoleSettings(tx, workspaceId)),
            now: () => now,
          };
          const submitted = await submitProposals(graph, { workspaceId, userId }, drafts);
          proposals = submitted.items.filter((i) => i.status !== 'refused').length;
        }
      } else if (role === null || !isRole(role)) {
        throw forbidden('The capturing member is no longer a member');
      }
    }

    // Nothing disappears: a result a person must check puts the capture in "Needs you".
    if (cap !== undefined && needsYou.length > 0 && cap.status === 'ready') {
      const reason = needsYou[0] ?? 'extraction_low_confidence';
      const next = transition(
        { status: cap.status, sourceMeta: cap.sourceMeta },
        'needs_you',
        now,
        reason,
      );
      await updateCapture(tx, cap.id, workspaceId, cap.status, next.status, {
        ...next.sourceMeta,
        needsYouReason: reason,
        extractionId: row.id,
      });
    }
    return {
      outcome: 'extracted',
      extractionId: row.id,
      deterministicOnly: found.deterministicOnly,
      proposals,
      needsYou,
    };
  });
}

async function updateCapture(
  tx: Transaction,
  captureId: string,
  workspaceId: string,
  from: typeof capture.$inferSelect.status,
  to: typeof capture.$inferSelect.status,
  sourceMeta: Record<string, unknown>,
): Promise<void> {
  await tx
    .update(capture)
    .set({ status: to, sourceMeta })
    .where(
      and(
        eq(capture.id, captureId),
        eq(capture.workspaceId, workspaceId),
        eq(capture.status, from),
      ),
    );
}
