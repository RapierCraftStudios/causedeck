// Verified chat items -> automation drafts (#526). Every item becomes a `task` draft anchored to the
// message it came from. A dated task is a proposal (L2) and an undated one reaches L3 only at
// confidence >= 0.8, both decided by the engine's matrix, not here. An instruction that came from
// the client is `ambiguous`, so it is always a card for the lawyer and never applied unasked.
import type { ProposalDraft } from '@causedeck/validators/proposal-draft';

import type { VerifiedChatItem } from './structure.ts';

export interface ChatDraftContext {
  captureId: string;
  /** The `ai_call` behind the items. */
  aiCallId: string | null;
  matterId?: string | null;
  /** Anchor ids by message id; a message without one yields an unanchored draft. */
  anchorIds?: ReadonlyMap<string, string>;
}

const CLIENT_INSTRUCTION =
  /\b(?:client|party|petitioner|respondent|complainant)\b.{0,40}\b(?:says?|said|wants?|wanted|asked|asks|told|tells|instructed?|insists?|requests?|requested)\b/i;

/** Whether the item relays a client's instruction: the model's flag, or the wording of the quote. */
export function isClientInstruction(item: Pick<VerifiedChatItem, 'clientInstruction' | 'quote'>): boolean {
  return item.clientInstruction || CLIENT_INSTRUCTION.test(item.quote);
}

export function chatItemsToDrafts(
  items: readonly VerifiedChatItem[],
  ctx: ChatDraftContext,
): ProposalDraft[] {
  return items.map((item) => {
    const anchor = ctx.anchorIds?.get(item.ref);
    return {
      kind: 'task',
      captureId: ctx.captureId,
      source: { type: 'ai', input: 'whatsapp', aiCallId: ctx.aiCallId, ref: item.ref },
      payload: {
        title: item.title,
        ...(item.dueDate === null ? {} : { dueDate: item.dueDate }),
        ...(ctx.matterId == null ? {} : { matterId: ctx.matterId }),
      },
      anchors: anchor === undefined ? [] : [anchor],
      confidence: item.confidence,
      ...(ctx.matterId == null ? {} : { matterId: ctx.matterId }),
      patternKey: 'whatsapp:task',
      ...(isClientInstruction(item) ? { ambiguous: true } : {}),
    } satisfies ProposalDraft;
  });
}
