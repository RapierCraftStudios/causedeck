'use server';
// Drafting studio checks, acknowledgement, fix and export actions (#828). Each goes through
// `workspaceAction` (zod input, session, membership, the policy action asserted by `guard`), and
// the drafting services decide again as the member: a clerk is FORBIDDEN, another workspace's draft
// or export is NOT_FOUND.
// - `runChecksAction`: checks the citations and the consistency of one version.
// - `acknowledgeUnverifiedAction`: the lawyer's acknowledgement of not-found citations (audited by
//   `acknowledgeUnverified`).
// - `applyFixAction`: replaces one finding's span with the graph value as a new version; the literal
//   `confirm: true` is required.
// - `exportDraftAction` / `downloadDraftExportAction`: queue the export, then hand out a short-lived
//   presigned download. Nothing here sends, shares or files anything.
// No draft text reaches a log: the actions return ids, counts and the checker's own findings.
import type { CitationReport } from '@causedeck/validators/citation';
import type { Finding } from '@causedeck/validators/consistency';
import { EXPORT_FORMATS } from '@causedeck/validators/drafting';
import { z } from 'zod';

import { domainErrorCode } from '../../../../../../lib/matters/graph-deps.ts';
import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import { objectStore } from '../../../../../../lib/storage.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

export interface ChecksResult {
  citations: CitationReport;
  findings: Finding[];
}

export interface FixedDraft {
  versionNo: number;
  versionId: string;
}

export type ExportOutcome =
  { status: 'ready'; exportId: string } | { status: 'queued'; draftVersionId: string };

export interface ExportDownload {
  url: string;
  filename: string;
}

const VersionScoped = WorkspaceScoped.extend({ draftVersionId: z.uuid() });

const AcknowledgeUnverified = VersionScoped.extend({
  citationIds: z.array(z.uuid()).min(1).max(200),
  reason: z.string().trim().min(3).max(500),
});

const ApplyFix = VersionScoped.extend({
  findingId: z.string().min(1).max(300),
  confirm: z.literal(true),
});

const ExportDraft = WorkspaceScoped.extend({
  draftId: z.uuid(),
  versionNo: z.number().int().min(1).optional(),
  format: z.enum(EXPORT_FORMATS),
});

const DownloadExport = WorkspaceScoped.extend({ exportId: z.uuid() });

/** Core domain errors become the client-safe codes; anything else stays an INTERNAL failure. */
function rethrow(error: unknown): never {
  const code = domainErrorCode(error);
  if (code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'VALIDATION' || code === 'CONFLICT') {
    throw new ActionError(code, '');
  }
  throw error;
}

const actorOf = (ctx: { workspaceId: string; userId: string }) => ({
  workspaceId: ctx.workspaceId,
  userId: ctx.userId,
});

const runChecks = workspaceAction(
  VersionScoped,
  async (input, ctx): Promise<ChecksResult> => {
    const { checkDraft, runConsistencyCheck } = await import('@causedeck/core/drafting');
    const deps = { db: ctx.tx };
    try {
      const citations = await checkDraft(deps, actorOf(ctx), input.draftVersionId);
      const report = await runConsistencyCheck(deps, actorOf(ctx), {
        draftVersionId: input.draftVersionId,
      });
      return { citations, findings: report.findings };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.write' },
);

export async function runChecksAction(raw: unknown): Promise<Result<ChecksResult>> {
  return runChecks(raw);
}

const acknowledge = workspaceAction(
  AcknowledgeUnverified,
  async (input, ctx): Promise<{ acknowledged: string[] }> => {
    const { acknowledgeUnverified } = await import('@causedeck/core/drafting');
    try {
      const result = await acknowledgeUnverified({ db: ctx.tx }, actorOf(ctx), {
        draftVersionId: input.draftVersionId,
        citationIds: input.citationIds,
        reason: input.reason,
      });
      return { acknowledged: result.acknowledged };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.export' },
);

export async function acknowledgeUnverifiedAction(
  raw: unknown,
): Promise<Result<{ acknowledged: string[] }>> {
  return acknowledge(raw);
}

const fix = workspaceAction(
  ApplyFix,
  async (input, ctx): Promise<FixedDraft> => {
    const { applyFix } = await import('@causedeck/core/drafting');
    try {
      const saved = await applyFix({ db: ctx.tx }, actorOf(ctx), {
        draftVersionId: input.draftVersionId,
        findingId: input.findingId,
        confirm: input.confirm,
      });
      return { versionNo: saved.versionNo, versionId: saved.id };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.write' },
);

export async function applyFixAction(raw: unknown): Promise<Result<FixedDraft>> {
  return fix(raw);
}

const exportDraft = workspaceAction(
  ExportDraft,
  async (input, ctx): Promise<ExportOutcome> => {
    const { exportDraft: queueExport } = await import('@causedeck/core/drafting');
    const { enqueue } = await import('@causedeck/core/jobs');
    try {
      const result = await queueExport(
        {
          db: ctx.tx,
          // Ids only; the job reads the draft itself.
          enqueue: (job) => enqueue('drafting.export', job),
        },
        actorOf(ctx),
        {
          draftId: input.draftId,
          format: input.format,
          ...(input.versionNo === undefined ? {} : { versionNo: input.versionNo }),
        },
      );
      return result.status === 'ready'
        ? { status: 'ready', exportId: result.export.id }
        : { status: 'queued', draftVersionId: result.draftVersionId };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.export' },
);

export async function exportDraftAction(raw: unknown): Promise<Result<ExportOutcome>> {
  return exportDraft(raw);
}

const download = workspaceAction(
  DownloadExport,
  async (input, ctx): Promise<ExportDownload> => {
    const { createDraftExportDownload } = await import('@causedeck/core/drafting');
    try {
      const link = await createDraftExportDownload(
        { db: ctx.tx, store: objectStore() },
        actorOf(ctx),
        input.exportId,
      );
      return { url: link.url, filename: link.filename };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.export' },
);

export async function downloadDraftExportAction(raw: unknown): Promise<Result<ExportDownload>> {
  return download(raw);
}
