// Sharing a draft (#735, ADR 0039): the lawyer's explicit act, from their own channel. The log row
// names the member, the channel and the version that was shared; the system sends nothing, and
// there is no job or system caller of these functions.
import { schema } from '@causedeck/db';
import { ShareRecord, type ShareChannel } from '@causedeck/validators/outward-draft';
import { and, desc, eq } from 'drizzle-orm';

import {
  auditOutward,
  inOutwardScope,
  notFoundDraft,
  parseOutwardInput,
  requireOutwardMatter,
  type OutwardActor,
  type OutwardDeps,
} from './context.ts';

const { outwardDraft, outwardDraftVersion, outwardShareLog } = schema;

export interface SharedRecord {
  shareId: string;
  finalVersionId: string;
  channel: ShareChannel;
}

/** Record that the signed-in lawyer shared the draft's latest version through `channel`. */
export async function recordShared(
  deps: OutwardDeps,
  actor: OutwardActor,
  input: unknown,
): Promise<SharedRecord> {
  const share = parseOutwardInput(ShareRecord, input);
  return inOutwardScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const workspaceId = scope.actor.workspaceId;
    const [draft] = await tx
      .select()
      .from(outwardDraft)
      .where(and(eq(outwardDraft.workspaceId, workspaceId), eq(outwardDraft.id, share.draftId)))
      .limit(1)
      .for('update');
    if (draft === undefined) throw notFoundDraft();
    try {
      await requireOutwardMatter(scope, draft.matterId, 'draft.write');
    } catch (error) {
      if ((error as { code?: string }).code === 'NOT_FOUND') throw notFoundDraft();
      throw error;
    }
    const [latest] = await tx
      .select({ id: outwardDraftVersion.id })
      .from(outwardDraftVersion)
      .where(
        and(
          eq(outwardDraftVersion.workspaceId, workspaceId),
          eq(outwardDraftVersion.draftId, draft.id),
        ),
      )
      .orderBy(desc(outwardDraftVersion.createdAt), desc(outwardDraftVersion.id))
      .limit(1);
    if (latest === undefined) throw notFoundDraft();
    const [log] = await tx
      .insert(outwardShareLog)
      .values({
        workspaceId,
        draftId: draft.id,
        memberId: scope.memberId,
        channel: share.channel,
        sharedAt: scope.now,
        finalVersionId: latest.id,
      })
      .returning({ id: outwardShareLog.id });
    if (log === undefined) throw notFoundDraft();
    await tx
      .update(outwardDraft)
      .set({ status: 'shared', updatedAt: scope.now })
      .where(and(eq(outwardDraft.workspaceId, workspaceId), eq(outwardDraft.id, draft.id)));
    await auditOutward(
      scope,
      'outward.shared',
      { kind: 'outward_draft', id: draft.id },
      { channel: share.channel, versionId: latest.id },
    );
    return { shareId: log.id, finalVersionId: latest.id, channel: share.channel };
  });
}

/** The lawyer copied the text: a share through the clipboard. */
export function recordCopied(
  deps: OutwardDeps,
  actor: OutwardActor,
  input: { draftId: string },
): Promise<SharedRecord> {
  return recordShared(deps, actor, { draftId: input.draftId, channel: 'clipboard' });
}
