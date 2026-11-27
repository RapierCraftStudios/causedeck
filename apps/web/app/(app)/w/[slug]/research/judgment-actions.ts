'use server';
// Judgment result actions (#1176, part 3 of #1170): the reader header and each Research result card
// offer "Save to matter" and "Insert into draft". All go through `workspaceAction` (strict zod input,
// session, membership, the policy action asserted by `guard`); the core services decide again as the
// member, so another workspace's matter, note or draft is NOT_FOUND and a role without the right is
// FORBIDDEN.
// - `loadActionTargetsAction`: the targets, loaded on demand (results are client-rendered): the
//   matters the member may read; with `matterId`, that matter's notes and its drafts with the blocks
//   an authority can follow.
// - `saveJudgmentToNoteAction`: pins the judgment as an authority on a research note of the matter
//   (a new note when none is picked). `memory.write`, like the matter's research tab.
// - `insertJudgmentIntoDraftAction`: delegates to core `insertAuthority`, which re-verifies the quote
//   against the stored judgment text; the client's quote is never trusted. `copilot.enabled` gates it
//   (flag off is NOT_FOUND, like `insertAuthorityAction`).
// No judgment or draft text reaches a log.
import type { Block } from '@causedeck/validators/drafting';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { keyedBlocks } from '../../../../../lib/drafting/blocks-edit.ts';
import { domainErrorCode } from '../../../../../lib/matters/graph-deps.ts';
import { ActionError, type Result } from '../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../lib/workspace-action.ts';
import { can, type Role } from '../../../../../lib/workspace-context.ts';

const MAX_MATTERS = 50;
const MAX_DRAFTS = 10;
const LABEL_CHARS = 80;

export interface ActionTargetDraft {
  id: string;
  title: string;
  versionId: string;
  blocks: { key: string; label: string }[];
}

export interface ActionTargets {
  matters: { id: string; title: string }[];
  /** Only with `matterId`. */
  notes: { id: string; title: string }[];
  /** Only with `matterId`; empty when the member may not write drafts. */
  drafts: ActionTargetDraft[];
}

export interface SavedJudgment {
  matterId: string;
  noteId: string;
}

export interface InsertedJudgment {
  draftId: string;
  versionNo: number;
  blockId: string;
}

const pinNo = z.number().int().positive().max(1_000_000);

const actorOf = (ctx: WorkspaceActionCtx) => ({
  workspaceId: ctx.workspaceId,
  userId: ctx.userId,
});

/** Core domain errors become the client-safe codes; anything else stays an INTERNAL failure. */
function rethrow(error: unknown): never {
  if (error instanceof ActionError) throw error;
  const code = domainErrorCode(error);
  if (
    code === 'NOT_FOUND' ||
    code === 'FORBIDDEN' ||
    code === 'VALIDATION' ||
    code === 'CONFLICT'
  ) {
    throw new ActionError(code, '');
  }
  throw error;
}

const clip = (text: string): string => {
  const label = text.replace(/\s+/g, ' ').trim();
  return label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS - 1)}…` : label;
};

/** The blocks an authority can go after: headings, paragraphs and sections, labelled by their text. */
function blockOptions(blocks: readonly Block[]): ActionTargetDraft['blocks'] {
  return keyedBlocks(blocks).flatMap(({ block, key }) => {
    const text =
      block.type === 'heading' || block.type === 'paragraph'
        ? block.text
        : block.type === 'section'
          ? (block.title ?? '')
          : '';
    const label = clip(text);
    return label === '' ? [] : [{ key, label }];
  });
}

const LoadTargets = WorkspaceScoped.extend({ matterId: z.uuid().optional() }).strict();

const loadTargets = workspaceAction(
  LoadTargets,
  async (input, ctx): Promise<ActionTargets> => {
    const actor = actorOf(ctx);
    try {
      const { listMatters } = await import('@causedeck/core/matter-graph');
      const page = await listMatters({ db: ctx.tx, events: { emit: () => undefined } }, actor, {
        limit: MAX_MATTERS,
      });
      const matters = page.items.map((m) => ({ id: m.id, title: m.title }));
      if (input.matterId === undefined) return { matters, notes: [], drafts: [] };

      const { listNotes } = await import('@causedeck/core/research');
      // A role without `memory.read` still gets the matter's drafts (it cannot save to a note anyway).
      const notes = can(ctx.role as Role, 'memory.read')
        ? (await listNotes(ctx.tx, actor, input.matterId)).map((n) => ({ id: n.id, title: n.title }))
        : [];
      const drafts: ActionTargetDraft[] = [];
      if (can(ctx.role as Role, 'draft.write')) {
        const { getDraft, listDrafts } = await import('@causedeck/core/drafting');
        const items = await listDrafts({ db: ctx.tx }, actor, { matterId: input.matterId });
        for (const item of items.slice(0, MAX_DRAFTS)) {
          const detail = await getDraft({ db: ctx.tx }, actor, { draftId: item.id });
          const blocks = blockOptions(detail.version.blocks);
          if (blocks.length > 0) {
            drafts.push({ id: item.id, title: item.title, versionId: detail.version.id, blocks });
          }
        }
      }
      return { matters, notes, drafts };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'matter.read' },
);

export async function loadActionTargetsAction(raw: unknown): Promise<Result<ActionTargets>> {
  return loadTargets(raw);
}

const SaveJudgment = WorkspaceScoped.extend({
  matterId: z.uuid(),
  /** Omitted: a new note titled after the judgment. */
  noteId: z.uuid().optional(),
  judgmentId: z.uuid(),
  label: z.string().trim().min(1).max(300),
  citation: z.string().trim().max(300).optional(),
}).strict();

const save = workspaceAction(
  SaveJudgment,
  async (input, ctx): Promise<SavedJudgment> => {
    const actor = actorOf(ctx);
    try {
      const { addAuthority, createNote } = await import('@causedeck/core/research');
      const noteId =
        input.noteId ??
        (
          await createNote(ctx.tx, actor, {
            matterId: input.matterId,
            title: input.label.slice(0, 200),
          })
        ).id;
      await addAuthority(ctx.tx, actor, {
        matterId: input.matterId,
        noteId,
        authority: {
          label: input.label,
          ...(input.citation ? { citation: input.citation } : {}),
        },
      });
      revalidatePath('/w/[slug]/matters/[id]/research', 'page');
      return { matterId: input.matterId, noteId };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'memory.write' },
);

export async function saveJudgmentToNoteAction(raw: unknown): Promise<Result<SavedJudgment>> {
  return save(raw);
}

const InsertJudgment = WorkspaceScoped.extend({
  draftId: z.uuid(),
  versionId: z.uuid(),
  afterBlockId: z.string().min(1).max(200),
  judgmentId: z.uuid(),
  quote: z.string().min(1).max(2000),
  para: pinNo.optional(),
  page: pinNo.optional(),
}).strict();

const insert = workspaceAction(
  InsertJudgment,
  async (input, ctx): Promise<InsertedJudgment> => {
    const { isFlagOffError, requireFlag } = await import('@causedeck/flags/server');
    try {
      await requireFlag('copilot.enabled', actorOf(ctx));
    } catch (error) {
      if (isFlagOffError(error)) throw new ActionError('NOT_FOUND', 'Not found');
      throw error;
    }
    const { insertAuthority } = await import('@causedeck/core/drafting');
    try {
      const result = await insertAuthority({ db: ctx.tx }, actorOf(ctx), {
        draftId: input.draftId,
        versionId: input.versionId,
        afterBlockId: input.afterBlockId,
        candidateRef: {
          judgmentId: input.judgmentId,
          quote: input.quote,
          ...(input.para === undefined ? {} : { para: input.para }),
          ...(input.page === undefined ? {} : { page: input.page }),
        },
      });
      return {
        draftId: input.draftId,
        versionNo: result.version.versionNo,
        blockId: result.blockId,
      };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.write' },
);

export async function insertJudgmentIntoDraftAction(
  raw: unknown,
): Promise<Result<InsertedJudgment>> {
  return insert(raw);
}
