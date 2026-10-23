'use server';
// Proceedings tab server actions (#392, #40 part 4). Each goes through `workspaceAction`
// (lib/workspace-action.ts): zod input, `requireSession`, membership and the policy action
// asserted by `guard` (`matter.write`; `matter.read` for the duplicate lookup), so a non-member
// gets FORBIDDEN before anything runs. The C02 matter-graph services run on the workspace-scoped
// transaction `ctx.tx` and decide again per matter, returning NOT_FOUND (another workspace's row
// too), FORBIDDEN, CONFLICT (an illegal transition, a refused merge, a stale undo) or VALIDATION
// through `toActionError`. Provenance is never taken from the client: a person typed it, so it is
// `manual`, and a state change is confirmed by its actor.
// - `createProceedingAction`, `updateProceedingAction` (`updateIdentifiers`; core has no wider
//   proceeding update), `linkProceedingsAction`, `transitionProceedingAction`.
// - `findDuplicateProceedingsAction`: the form's "Looks like … Merge?" prompt.
// - `previewMergeAction` / `mergeMattersAction` / `undoMergeAction` and `previewSplitAction` /
//   `splitMatterAction` / `undoSplitAction`. The undo takes back the `UndoPayload` the operation
//   returned; the client keeps it for the 10 s of the Undo toast (durable storage is #47).
import {
  PROCEEDING_KINDS,
  PROCEEDING_LINK_KINDS,
  PROCEEDING_STATES,
} from '@causedeck/validators/matter-graph';
import {
  MatterMergeUndoPayload,
  MatterSplitUndoPayload,
} from '@causedeck/validators/matter-graph-inputs';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { domainErrorCode, graphDeps } from '../../../../../../../lib/matters/graph-deps.ts';
import { ActionError, type Result } from '../../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../../lib/workspace-action.ts';

const MANUAL = { sourceType: 'manual' } as const;
const text = z.string().trim().min(1).max(200);
const optionalText = text.nullable().optional();
const year = z.int().min(0).max(2200);
const day = z.iso.date();

function actorOf(ctx: WorkspaceActionCtx) {
  return { workspaceId: ctx.workspaceId, userId: ctx.userId };
}

const DOMAIN_CODES = ['NOT_FOUND', 'FORBIDDEN', 'CONFLICT', 'VALIDATION'] as const;
type DomainCode = (typeof DOMAIN_CODES)[number];

/**
 * Runs a matter-graph call. Its typed subclasses of `WorkspaceError` (`CrossWorkspaceError`, which
 * is NOT_FOUND, and `InvalidTransitionError`, which is CONFLICT) carry their own `name`, which
 * `toActionError` does not recognise; they become the matching `ActionError` here, so another
 * workspace's proceeding is NOT_FOUND and an illegal move is CONFLICT, never INTERNAL.
 */
async function graph<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const code = domainErrorCode(error);
    if (code !== undefined && (DOMAIN_CODES as readonly string[]).includes(code)) {
      throw new ActionError(code as DomainCode, (error as Error).message);
    }
    throw error;
  }
}

/** The service input: the action input without the `workspaceId` the guard already used. */
function withoutWorkspace<T extends { workspaceId: string }>(input: T): Omit<T, 'workspaceId'> {
  const fields: Partial<T> = { ...input };
  delete fields.workspaceId;
  return fields as Omit<T, 'workspaceId'>;
}

function revalidateMatter(): void {
  revalidatePath('/w/[slug]/matters/[id]', 'layout');
  revalidatePath('/w/[slug]/matters', 'page');
}

/** A proceeding as the tab needs it back after a write. */
export interface ProceedingSaved {
  id: string;
  matterId: string;
  state: string;
  caseType: string;
  number: string | null;
  year: number | null;
}

function saved(row: {
  id: string;
  matterId: string;
  state: string;
  caseTypeRaw: string | null;
  caseTypeCode: string;
  number: string | null;
  year: number | null;
}): ProceedingSaved {
  return {
    id: row.id,
    matterId: row.matterId,
    state: row.state,
    caseType: row.caseTypeRaw ?? row.caseTypeCode,
    number: row.number,
    year: row.year,
  };
}

const identifiers = {
  number: optionalText,
  year: year.nullable().optional(),
  cnr: optionalText,
  srNo: optionalText,
  frNo: optionalText,
  diaryNo: optionalText,
  filingNo: optionalText,
};

// ---------------------------------------------------------------------------------------------
// Create, update, link, transition.

const CreateProceeding = WorkspaceScoped.extend({
  matterId: z.uuid(),
  forumId: z.uuid(),
  kind: z.enum(PROCEEDING_KINDS).optional(),
  caseType: text,
  ...identifiers,
  parentProceedingId: z.uuid().nullable().optional(),
});

const create = workspaceAction(
  CreateProceeding,
  async (input, ctx) => {
    const { createProceeding } = await import('@causedeck/core/matter-graph');
    const fields = withoutWorkspace(input);
    const row = await graph(() =>
      createProceeding(graphDeps(ctx.tx), actorOf(ctx), {
        ...fields,
        provenance: MANUAL,
      }),
    );
    revalidateMatter();
    return saved(row);
  },
  { action: 'matter.write' },
);

export async function createProceedingAction(raw: unknown): Promise<Result<ProceedingSaved>> {
  return create(raw);
}

const UpdateProceeding = WorkspaceScoped.extend({
  proceedingId: z.uuid(),
  caseType: text.optional(),
  ...identifiers,
});

const update = workspaceAction(
  UpdateProceeding,
  async (input, ctx) => {
    const { updateIdentifiers } = await import('@causedeck/core/matter-graph');
    const fields = withoutWorkspace(input);
    const row = await graph(() => updateIdentifiers(graphDeps(ctx.tx), actorOf(ctx), fields));
    revalidateMatter();
    return saved(row);
  },
  { action: 'matter.write' },
);

export async function updateProceedingAction(raw: unknown): Promise<Result<ProceedingSaved>> {
  return update(raw);
}

const LinkProceedings = WorkspaceScoped.extend({
  fromProceedingId: z.uuid(),
  toProceedingId: z.uuid(),
  kind: z.enum(PROCEEDING_LINK_KINDS),
});

const link = workspaceAction(
  LinkProceedings,
  async (input, ctx) => {
    const { linkProceedings } = await import('@causedeck/core/matter-graph');
    const row = await graph(() =>
      linkProceedings(graphDeps(ctx.tx), actorOf(ctx), {
        fromProceedingId: input.fromProceedingId,
        toProceedingId: input.toProceedingId,
        kind: input.kind,
        provenance: MANUAL,
      }),
    );
    revalidateMatter();
    return { linkId: row.id, kind: row.kind };
  },
  { action: 'matter.write' },
);

export async function linkProceedingsAction(
  raw: unknown,
): Promise<Result<{ linkId: string; kind: string }>> {
  return link(raw);
}

const TransitionProceeding = WorkspaceScoped.extend({
  proceedingId: z.uuid(),
  to: z.enum(PROCEEDING_STATES),
  reason: text.max(2000).optional(),
  number: text.optional(),
  year: year.optional(),
  cureDeadline: day.optional(),
});

const transition = workspaceAction(
  TransitionProceeding,
  async (input, ctx) => {
    const { transitionProceeding } = await import('@causedeck/core/matter-graph');
    const fields = withoutWorkspace(input);
    // The core input refines the pairs (number and year for `numbered`, a cure deadline only for
    // `defects`); the state machine decides which moves are legal.
    const result = await graph(() => transitionProceeding(graphDeps(ctx.tx), actorOf(ctx), fields));
    revalidateMatter();
    return saved(result.proceeding);
  },
  { action: 'matter.write' },
);

export async function transitionProceedingAction(raw: unknown): Promise<Result<ProceedingSaved>> {
  return transition(raw);
}

// ---------------------------------------------------------------------------------------------
// Duplicates.

export interface DuplicateHit {
  id: string;
  matterId: string;
  /** In the matter the form is open on. */
  sameMatter: boolean;
  caseType: string;
  number: string | null;
  year: number | null;
  cnr: string | null;
}

const FindDuplicates = WorkspaceScoped.extend({
  matterId: z.uuid(),
  identity: z.strictObject({
    forumId: z.uuid().optional(),
    caseType: text.optional(),
    number: text.optional(),
    year: year.optional(),
    cnr: text.optional(),
  }),
  excludeProceedingId: z.uuid().optional(),
});

const duplicates = workspaceAction(
  FindDuplicates,
  async (input, ctx) => {
    const { findDuplicateProceedings } = await import('@causedeck/core/matter-graph');
    const rows = await graph(() =>
      findDuplicateProceedings(graphDeps(ctx.tx), actorOf(ctx), {
        identity: input.identity,
        ...(input.excludeProceedingId === undefined
          ? {}
          : { excludeProceedingId: input.excludeProceedingId }),
        limit: 5,
      }),
    );
    // Only identifiers, never the other matter's title or parties.
    return rows.map((row): DuplicateHit => ({
      id: row.id,
      matterId: row.matterId,
      sameMatter: row.matterId === input.matterId.toLowerCase(),
      caseType: row.caseTypeRaw ?? row.caseTypeCode,
      number: row.number,
      year: row.year,
      cnr: row.cnr,
    }));
  },
  { action: 'matter.read' },
);

export async function findDuplicateProceedingsAction(
  raw: unknown,
): Promise<Result<DuplicateHit[]>> {
  return duplicates(raw);
}

// ---------------------------------------------------------------------------------------------
// Merges and splits.

export interface MovePreviewView {
  proceedings: { id: string; caseType: string; number: string | null; year: number | null }[];
  documents: number;
  obligations: number;
  crossingLinks: number;
  intoSensitive: boolean;
  fromSensitive: boolean;
  blocked: 'sensitive' | 'restricted' | 'merged' | 'archived' | null;
}

const MergeMatters = WorkspaceScoped.extend({ intoMatterId: z.uuid(), fromMatterId: z.uuid() });

const previewMerge = workspaceAction(
  MergeMatters,
  async (input, ctx) => {
    const { previewMergeMatters } = await import('@causedeck/core/matter-graph');
    const preview = await graph(() =>
      previewMergeMatters(graphDeps(ctx.tx), actorOf(ctx), {
        intoMatterId: input.intoMatterId,
        fromMatterId: input.fromMatterId,
      }),
    );
    return {
      proceedings: preview.proceedings,
      documents: preview.documentIds.length,
      obligations: preview.obligationIds.length,
      crossingLinks: 0,
      intoSensitive: preview.intoSensitive,
      fromSensitive: preview.fromSensitive,
      blocked: preview.blocked,
    } satisfies MovePreviewView;
  },
  { action: 'matter.write' },
);

export async function previewMergeAction(raw: unknown): Promise<Result<MovePreviewView>> {
  return previewMerge(raw);
}

export interface MergedMatters {
  matterId: string;
  fromMatterId: string;
  undo: MatterMergeUndoPayload;
}

const merge = workspaceAction(
  MergeMatters,
  async (input, ctx) => {
    const { mergeMatters } = await import('@causedeck/core/matter-graph');
    const result = await graph(() =>
      mergeMatters(graphDeps(ctx.tx), actorOf(ctx), {
        intoMatterId: input.intoMatterId,
        fromMatterId: input.fromMatterId,
      }),
    );
    revalidateMatter();
    return { matterId: result.matter.id, fromMatterId: result.from.id, undo: result.undo };
  },
  { action: 'matter.write' },
);

export async function mergeMattersAction(raw: unknown): Promise<Result<MergedMatters>> {
  return merge(raw);
}

const UndoMerge = WorkspaceScoped.extend({ payload: MatterMergeUndoPayload });

const undoMergeCall = workspaceAction(
  UndoMerge,
  async (input, ctx) => {
    const { undoMerge } = await import('@causedeck/core/matter-graph');
    const result = await graph(() =>
      undoMerge(graphDeps(ctx.tx), actorOf(ctx), { payload: input.payload }),
    );
    revalidateMatter();
    return { matterId: result.matter.id };
  },
  { action: 'matter.write' },
);

export async function undoMergeAction(raw: unknown): Promise<Result<{ matterId: string }>> {
  return undoMergeCall(raw);
}

const proceedingIds = z
  .array(z.uuid())
  .min(1)
  .max(500)
  .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
    message: 'Proceedings must not repeat',
  });

const PreviewSplit = WorkspaceScoped.extend({ matterId: z.uuid(), proceedingIds });

const previewSplit = workspaceAction(
  PreviewSplit,
  async (input, ctx) => {
    const { previewSplitMatter } = await import('@causedeck/core/matter-graph');
    const preview = await graph(() =>
      previewSplitMatter(graphDeps(ctx.tx), actorOf(ctx), {
        matterId: input.matterId,
        proceedingIds: input.proceedingIds,
      }),
    );
    return {
      proceedings: preview.proceedings,
      // Documents belong to the matter, not a proceeding: a split leaves them where they are.
      documents: 0,
      obligations: preview.obligationIds.length,
      crossingLinks: preview.crossingLinks,
      intoSensitive: false,
      fromSensitive: false,
      blocked: preview.blocked,
    } satisfies MovePreviewView;
  },
  { action: 'matter.write' },
);

export async function previewSplitAction(raw: unknown): Promise<Result<MovePreviewView>> {
  return previewSplit(raw);
}

export interface SplitMatterDone {
  newMatterId: string;
  newMatterHref: string;
  undo: MatterSplitUndoPayload;
  crossing: number;
}

const SplitMatter = PreviewSplit.extend({
  slug: z.string().min(1).max(100),
  newTitle: z.string().trim().min(1).max(500),
});

const split = workspaceAction(
  SplitMatter,
  async (input, ctx) => {
    const { splitMatter } = await import('@causedeck/core/matter-graph');
    const result = await graph(() =>
      splitMatter(graphDeps(ctx.tx), actorOf(ctx), {
        matterId: input.matterId,
        proceedingIds: input.proceedingIds,
        newTitle: input.newTitle,
      }),
    );
    revalidateMatter();
    return {
      newMatterId: result.matter.id,
      newMatterHref: `/w/${encodeURIComponent(input.slug)}/matters/${encodeURIComponent(result.matter.id)}`,
      undo: result.undo,
      crossing: result.crossing.length,
    };
  },
  { action: 'matter.write' },
);

export async function splitMatterAction(raw: unknown): Promise<Result<SplitMatterDone>> {
  return split(raw);
}

const UndoSplit = WorkspaceScoped.extend({ payload: MatterSplitUndoPayload });

const undoSplitCall = workspaceAction(
  UndoSplit,
  async (input, ctx) => {
    const { undoSplit } = await import('@causedeck/core/matter-graph');
    const result = await graph(() =>
      undoSplit(graphDeps(ctx.tx), actorOf(ctx), { payload: input.payload }),
    );
    revalidateMatter();
    return { matterId: result.matter.id };
  },
  { action: 'matter.write' },
);

export async function undoSplitAction(raw: unknown): Promise<Result<{ matterId: string }>> {
  return undoSplitCall(raw);
}
