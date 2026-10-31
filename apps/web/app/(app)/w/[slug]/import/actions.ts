'use server';
// Bootstrap import server actions (#57 part 4, #550). Each goes through `workspaceAction`
// (lib/workspace-action.ts): strict zod input, `requireSession`, membership and the policy action
// asserted by `guard`. The domain (`@causedeck/core/import`) runs on the workspace-scoped
// transaction `ctx.tx`; an id of another workspace is NOT_FOUND. Starting a batch, adding the
// captures a `bulk_import` upload made, building the plan, applying it and undoing it need
// `matter.write`. Building the plan reads only rows that match the member's own identifiers: without
// a saved enrolment number or name spelling the action asks for them and saves them only once the
// member confirmed what was proposed. Nothing is sent, filed or paid.
import type { ApplyDecisions, ImportPlan } from '@causedeck/core/import';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { graphDeps } from '../../../../../lib/matters/graph-deps.ts';
import type { Result } from '../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../lib/workspace-action.ts';

const BatchTarget = WorkspaceScoped.extend({ batchId: z.uuid() }).strict();
const AddFiles = BatchTarget.extend({ captureIds: z.array(z.uuid()).min(1).max(200) }).strict();
const Identifiers = z
  .object({
    enrolmentNumbers: z.array(z.string().trim().min(1).max(60)).max(20),
    aliases: z.array(z.string().trim().min(1).max(120)).max(50),
  })
  .strict();
const BuildPlan = BatchTarget.extend({
  /** What the member typed; proposed back for confirmation, saved only with `confirmIdentifiers`. */
  identifiers: Identifiers.optional(),
  confirmIdentifiers: z.boolean().optional(),
}).strict();
const Decisions = z
  .object({
    matters: z
      .record(
        z.string().max(40),
        z
          .object({
            action: z.enum(['apply', 'skip', 'merge']).optional(),
            mergeIntoMatterId: z.uuid().optional(),
            corrected: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
    resolvedDates: z
      .record(z.string().max(200), z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .optional(),
    includeSensitive: z.array(z.string().max(40)).max(500).optional(),
  })
  .strict();
const PlanEdits = BatchTarget.extend({
  groups: z
    .array(
      z
        .object({
          tempId: z.string().min(1).max(40),
          title: z.string().trim().min(1).max(200),
          proceedingKeys: z.array(z.string().min(1).max(200)).min(1).max(200),
        })
        .strict(),
    )
    .min(1)
    .max(500),
}).strict();
const ApplyPlan = BatchTarget.extend({ decisions: Decisions.optional() }).strict();

/** The decisions without `undefined` members (`exactOptionalPropertyTypes`). */
function toDecisions(input: z.output<typeof Decisions>): ApplyDecisions {
  const matters = Object.fromEntries(
    Object.entries(input.matters ?? {}).map(([tempId, choice]) => [
      tempId,
      {
        ...(choice.action === undefined ? {} : { action: choice.action }),
        ...(choice.mergeIntoMatterId === undefined
          ? {}
          : { mergeIntoMatterId: choice.mergeIntoMatterId }),
        ...(choice.corrected === undefined ? {} : { corrected: choice.corrected }),
      },
    ]),
  );
  return {
    ...(input.matters === undefined ? {} : { matters }),
    ...(input.resolvedDates === undefined ? {} : { resolvedDates: input.resolvedDates }),
    ...(input.includeSensitive === undefined ? {} : { includeSensitive: input.includeSensitive }),
  };
}

const actorOf = (ctx: WorkspaceActionCtx) => ({
  workspaceId: ctx.workspaceId,
  userId: ctx.userId,
});

/** Core's deps on the action's transaction. */
const depsOf = (ctx: WorkspaceActionCtx) => ({ db: ctx.tx });

export interface BatchStartedView {
  batchId: string;
}

export interface FilesAddedView {
  added: number;
  skipped: number;
}

export interface ImportProgressView {
  batchId: string;
  status: string;
  total: number;
  files: Record<string, number>;
  matchedRows: number;
  /** Files kept as attachments without reading (free-plan cap). */
  keptAsAttachments: number;
  needsIdentifiers: boolean;
}

export type BuildPlanView =
  | { status: 'processing' }
  /** No identifiers saved: nothing was imported; ask for them. */
  | { status: 'needs_identifiers' }
  /** The proposed identifiers, normalised: show them and call again with `confirmIdentifiers`. */
  | {
      status: 'confirm_identifiers';
      identifiers: { enrolmentNumbers: string[]; aliases: string[] };
    };

export interface ApplyView {
  batchId: string;
  planHash: string;
  rootActivityId: string;
  created: Record<string, number>;
  duplicates: number;
  excluded: number;
  unresolvedProceedingKeys: string[];
}

const start = workspaceAction(
  WorkspaceScoped.strict(),
  async (_input, ctx): Promise<BatchStartedView> => {
    const { createImportBatch } = await import('@causedeck/core/import');
    const created = await createImportBatch(depsOf(ctx), actorOf(ctx));
    revalidatePath('/w/[slug]/import', 'page');
    return created;
  },
  { action: 'matter.write' },
);

const addFiles = workspaceAction(
  AddFiles,
  async ({ batchId, captureIds }, ctx): Promise<FilesAddedView> => {
    const { addImportFiles } = await import('@causedeck/core/import');
    const result = await addImportFiles(depsOf(ctx), actorOf(ctx), { batchId, captureIds });
    revalidatePath('/w/[slug]/import', 'page');
    return result;
  },
  { action: 'matter.write' },
);

const progress = workspaceAction(
  BatchTarget,
  async ({ batchId }, ctx): Promise<ImportProgressView> => {
    const { getImportProgress } = await import('@causedeck/core/import');
    return getImportProgress(depsOf(ctx), actorOf(ctx), batchId);
  },
  { action: 'matter.read' },
);

const buildPlan = workspaceAction(
  BuildPlan,
  async ({ batchId, identifiers, confirmIdentifiers }, ctx): Promise<BuildPlanView> => {
    const { getAdvocateProfile, getImportProgress, saveAdvocateProfile } =
      await import('@causedeck/core/import');
    const actor = actorOf(ctx);
    // NOT_FOUND for a batch of another workspace, before anything is saved.
    await getImportProgress(depsOf(ctx), actor, batchId);
    let saved = false;
    if (identifiers !== undefined) {
      const result = await saveAdvocateProfile(ctx.tx, actor, {
        ...identifiers,
        confirmed: confirmIdentifiers === true,
      });
      if (!result.saved) return { status: 'confirm_identifiers', identifiers: result.identifiers };
      saved = true;
    }
    const own = await getAdvocateProfile(ctx.tx, actor);
    if (own.enrolmentNumbers.length === 0 && own.aliases.length === 0) {
      return { status: 'needs_identifiers' };
    }
    const { enqueue } = await import('@causedeck/core/jobs');
    // After the commit of this transaction: the job reads the identifiers just saved.
    await enqueue(
      'import.batch',
      { workspaceId: ctx.workspaceId, batchId, reprocess: saved ? 'unmatched' : 'failed' },
      { startAfter: 3 },
    );
    revalidatePath('/w/[slug]/import', 'page');
    return { status: 'processing' };
  },
  { action: 'matter.write' },
);

const readPlan = workspaceAction(
  BatchTarget,
  async ({ batchId }, ctx): Promise<ImportPlan> => {
    const { getImportPlan } = await import('@causedeck/core/import');
    return getImportPlan(depsOf(ctx), actorOf(ctx), batchId);
  },
  { action: 'matter.read' },
);

const savePlanEdits = workspaceAction(
  PlanEdits,
  async ({ batchId, groups }, ctx): Promise<ImportPlan> => {
    const { saveEditedImportPlan } = await import('@causedeck/core/import');
    const plan = await saveEditedImportPlan(depsOf(ctx), actorOf(ctx), { batchId, groups });
    revalidatePath('/w/[slug]/import', 'page');
    return plan;
  },
  { action: 'matter.write' },
);

const applyPlan = workspaceAction(
  ApplyPlan,
  async ({ batchId, decisions }, ctx): Promise<ApplyView> => {
    const { applyImportPlan } = await import('@causedeck/core/import');
    const result = await applyImportPlan(graphDeps(ctx.tx), actorOf(ctx), {
      batchId,
      ...(decisions === undefined ? {} : { decisions: toDecisions(decisions) }),
    });
    // Free alerts (#506): the confirmed cases are watched with no further setup (dark behind
    // `growth.free-alerts`, free plan only). Enrolment never fails the confirm.
    try {
      const { enrollFreeAlerts } = await import('@causedeck/core/free-alerts');
      await enrollFreeAlerts({ db: ctx.tx }, actorOf(ctx));
    } catch {
      // Watches are added again the next time cases are confirmed.
    }
    revalidatePath('/w/[slug]/import', 'page');
    revalidatePath('/w/[slug]/matters', 'page');
    return {
      batchId: result.batchId,
      planHash: result.planHash,
      rootActivityId: result.rootActivityId,
      created: { ...result.created },
      duplicates: result.duplicates.length,
      excluded: result.excluded.length,
      unresolvedProceedingKeys: result.unresolvedProceedingKeys,
    };
  },
  { action: 'matter.write' },
);

const undoBatch = workspaceAction(
  BatchTarget,
  async ({ batchId }, ctx) => {
    const { undoImportBatch } = await import('@causedeck/core/import');
    const result = await undoImportBatch(graphDeps(ctx.tx), actorOf(ctx), { batchId });
    revalidatePath('/w/[slug]/import', 'page');
    revalidatePath('/w/[slug]/matters', 'page');
    return result;
  },
  { action: 'matter.write' },
);

export async function startImportBatchAction(raw: unknown): Promise<Result<BatchStartedView>> {
  return start(raw);
}

export async function addImportFilesAction(raw: unknown): Promise<Result<FilesAddedView>> {
  return addFiles(raw);
}

export async function importProgressAction(raw: unknown): Promise<Result<ImportProgressView>> {
  return progress(raw);
}

export async function buildImportPlanAction(raw: unknown): Promise<Result<BuildPlanView>> {
  return buildPlan(raw);
}

export async function getImportPlanAction(raw: unknown): Promise<Result<ImportPlan>> {
  return readPlan(raw);
}

export async function saveImportPlanEditsAction(raw: unknown): Promise<Result<ImportPlan>> {
  return savePlanEdits(raw);
}

export async function applyImportPlanAction(raw: unknown): Promise<Result<ApplyView>> {
  return applyPlan(raw);
}

export async function undoImportBatchAction(raw: unknown) {
  return undoBatch(raw);
}
