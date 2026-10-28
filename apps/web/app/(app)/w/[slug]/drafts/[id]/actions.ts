'use server';
// Drafting studio server actions (#827). Both go through `workspaceAction` (zod input, session,
// membership, `draft.write` asserted by `guard`), and the drafting services decide again as the
// member (`asDraftMember`): a clerk is FORBIDDEN, another workspace's draft is NOT_FOUND.
// - `saveDraftAction`: saves the block tree as the draft's next immutable version. `baseVersionNo`
//   is the version the editor started from; a newer head is CONFLICT, so an offline edit never
//   overwrites work saved elsewhere.
// - `restoreDraftVersionAction`: copies an earlier version into a new one; the old one stays.
// No draft text reaches a log: the services and these actions return version numbers only.
import { z } from 'zod';

import { domainErrorCode } from '../../../../../../lib/matters/graph-deps.ts';
import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

export interface SavedDraftVersion {
  versionNo: number;
  versionId: string;
}

const DraftScoped = WorkspaceScoped.extend({ draftId: z.uuid() });

const SaveDraft = DraftScoped.extend({
  baseVersionNo: z.number().int().min(1),
  // The block tree is validated by `checkBlocksFor` in the service (strict schema, size caps).
  blocks: z.array(z.unknown()).max(2000),
});

const RestoreVersion = DraftScoped.extend({ versionNo: z.number().int().min(1) });

/** Core domain errors become the client-safe codes; anything else stays an INTERNAL failure. */
function rethrow(error: unknown): never {
  const code = domainErrorCode(error);
  if (code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'VALIDATION') {
    throw new ActionError(code, '');
  }
  throw error;
}

const save = workspaceAction(
  SaveDraft,
  async (input, ctx): Promise<SavedDraftVersion> => {
    const { listVersions, saveVersion } = await import('@causedeck/core/drafting');
    const deps = { db: ctx.tx };
    const actor = { workspaceId: ctx.workspaceId, userId: ctx.userId };
    try {
      const [head] = await listVersions(deps, actor, { draftId: input.draftId });
      if (head !== undefined && head.versionNo !== input.baseVersionNo) {
        throw new ActionError('CONFLICT', '');
      }
      const saved = await saveVersion(deps, actor, {
        draftId: input.draftId,
        content: input.blocks,
      });
      return { versionNo: saved.versionNo, versionId: saved.id };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.write' },
);

export async function saveDraftAction(raw: unknown): Promise<Result<SavedDraftVersion>> {
  return save(raw);
}

const restore = workspaceAction(
  RestoreVersion,
  async (input, ctx): Promise<SavedDraftVersion> => {
    const { restoreVersion } = await import('@causedeck/core/drafting');
    try {
      const restored = await restoreVersion(
        { db: ctx.tx },
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        { draftId: input.draftId, versionNo: input.versionNo },
      );
      return { versionNo: restored.versionNo, versionId: restored.id };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.write' },
);

export async function restoreDraftVersionAction(raw: unknown): Promise<Result<SavedDraftVersion>> {
  return restore(raw);
}
