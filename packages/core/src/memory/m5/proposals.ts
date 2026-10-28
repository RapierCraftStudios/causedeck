// M5 precedent proposals (#901, ADR 0046). A passage of a draft the lawyer exported is filed as an
// L2 `memory_proposal` (key `M5.precedent`, status `proposed`): nothing here writes `memory_item` or
// `precedent_passage` until `confirmPrecedentProposal`, which saves both in one transaction through
// `confirmMemory`. A dismissal records a reason code, and the same passage (same draft version,
// block and text) is not proposed again for 30 days. The proposal's evidence holds ids and the
// reason code, never the passage text; the text is sealed in `proposed_value_ciphertext`.
import { createHash } from 'node:crypto';

import { schema } from '@causedeck/db';
import {
  PRECEDENT_DISMISS_REST_DAYS,
  PrecedentDismissReason,
  PrecedentProposalSchema,
  type MemoryItem,
  type MemoryProposal,
} from '@causedeck/validators';
import { and, eq, gt, inArray } from 'drizzle-orm';

import { forbidden, invalid, notFound } from '../../shared/errors.ts';
import { confirmMemory } from '../confirm.ts';
import { embedMemoryText, localMemoryEmbedder, writeItemEmbedding } from '../embedding.ts';
import { parseMemoryInput, proposeMemory } from '../propose.ts';
import {
  canWriteMemory,
  inScope,
  nowOf,
  opener,
  requireRole,
  sealValue,
  type MemoryActor,
  type MemoryDeps,
} from '../scope.ts';

import { memoryText, saveConfirmedPassage, type M5Deps } from './precedent-bank.ts';

const { memoryProposal, draftVersion, draftExport, memoryItem } = schema;

const DAY_MS = 24 * 60 * 60 * 1000;
const normalise = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

const patternKeyOf = (versionId: string, anchorId: string, text: string): string =>
  createHash('sha256')
    .update(['precedent', versionId, anchorId, normalise(text)].join('\u0000'))
    .digest('hex')
    .slice(0, 40);

/** Does a block with this id and text exist in the version's content tree? */
function hasBlock(node: unknown, anchorId: string, text: string): boolean {
  if (Array.isArray(node)) return node.some((n) => hasBlock(n, anchorId, text));
  if (node === null || typeof node !== 'object') return false;
  const record = node as Record<string, unknown>;
  if (record['id'] === anchorId && typeof record['text'] === 'string') {
    return normalise(record['text']).includes(normalise(text));
  }
  return Object.values(record).some((v) => hasBlock(v, anchorId, text));
}

/**
 * File a passage of an exported draft for the lawyer to confirm. Returns null when memory is
 * paused, when the same passage is already proposed, or when it was dismissed in the last 30 days.
 * The draft version must be the actor's own and must have been exported, and must contain the block.
 */
export async function proposePrecedent(
  deps: MemoryDeps,
  actor: MemoryActor,
  input: unknown,
): Promise<MemoryProposal | null> {
  const parsed = parseMemoryInput(PrecedentProposalSchema, input);
  const { draftVersionId, anchorId } = parsed.sourceAnchor;
  const patternKey = patternKeyOf(draftVersionId, anchorId, parsed.passageText);
  const now = nowOf(deps);
  const role = await requireRole(deps, actor);
  if (!canWriteMemory(role)) throw forbidden('This role cannot propose memory');
  await inScope(deps, actor, async (tx) => {
    const [version] = await tx
      .select({ content: draftVersion.content, createdBy: draftVersion.createdBy })
      .from(draftVersion)
      .innerJoin(
        draftExport,
        and(
          eq(draftExport.workspaceId, draftVersion.workspaceId),
          eq(draftExport.draftVersionId, draftVersion.id),
        ),
      )
      .where(
        and(eq(draftVersion.workspaceId, actor.workspaceId), eq(draftVersion.id, draftVersionId)),
      )
      .limit(1);
    if (version === undefined) throw notFound('Exported draft version not found');
    if (version.createdBy !== actor.userId) {
      throw forbidden('A passage is proposed only from your own draft');
    }
    if (!hasBlock(version.content, anchorId, parsed.passageText)) {
      throw invalid('The passage is not in that block of the draft');
    }
  });
  const blocked = await inScope(deps, actor, async (tx) => {
    const since = new Date(now.getTime() - PRECEDENT_DISMISS_REST_DAYS * DAY_MS);
    const [row] = await tx
      .select({ id: memoryProposal.id })
      .from(memoryProposal)
      .where(
        and(
          eq(memoryProposal.workspaceId, actor.workspaceId),
          eq(memoryProposal.ownerUserId, actor.userId),
          eq(memoryProposal.patternKey, patternKey),
          eq(memoryProposal.status, 'proposed'),
        ),
      )
      .limit(1);
    if (row !== undefined) return true;
    const [dismissed] = await tx
      .select({ id: memoryProposal.id })
      .from(memoryProposal)
      .where(
        and(
          eq(memoryProposal.workspaceId, actor.workspaceId),
          eq(memoryProposal.ownerUserId, actor.userId),
          eq(memoryProposal.patternKey, patternKey),
          eq(memoryProposal.status, 'dismissed'),
          gt(memoryProposal.decidedAt, since),
        ),
      )
      .limit(1);
    return dismissed !== undefined;
  });
  if (blocked) return null;
  return proposeMemory(
    deps,
    actor,
    {
      key: 'M5.precedent',
      value: parsed.passageText,
      scope: 'user',
      sourceType: 'ai',
      sourceRef: draftVersionId,
      confidence: parsed.confidence,
      evidence: {
        kind: parsed.kind,
        courtId: parsed.courtId ?? '',
        language: parsed.language,
        draftVersionId,
        anchorId,
      },
    },
    { patternKey },
  );
}

/** Decline a precedent proposal with a reason code; the passage rests 30 days. */
export async function dismissPrecedentProposal(
  deps: MemoryDeps,
  actor: MemoryActor,
  proposalId: string,
  reason: unknown,
): Promise<void> {
  const code = parseMemoryInput(PrecedentDismissReason, reason);
  const role = await requireRole(deps, actor);
  if (!canWriteMemory(role)) throw forbidden('This role cannot change memory');
  const now = nowOf(deps);
  await inScope(deps, actor, async (tx) => {
    const [proposal] = await tx
      .select({ evidence: memoryProposal.evidence })
      .from(memoryProposal)
      .where(
        and(
          eq(memoryProposal.workspaceId, actor.workspaceId),
          eq(memoryProposal.id, proposalId),
          eq(memoryProposal.ownerUserId, actor.userId),
          eq(memoryProposal.status, 'proposed'),
          eq(memoryProposal.key, 'M5.precedent'),
        ),
      );
    if (proposal === undefined) throw notFound('Proposal not found');
    await tx
      .update(memoryProposal)
      .set({
        status: 'dismissed',
        decidedAt: now,
        evidence: { ...proposal.evidence, dismissReason: code },
      })
      .where(
        and(eq(memoryProposal.workspaceId, actor.workspaceId), eq(memoryProposal.id, proposalId)),
      );
  });
}

export interface ConfirmedPrecedent {
  item: MemoryItem;
  passageId: string;
}

/**
 * Save a precedent proposal: the M5 item (`confirmMemory`), its typed passage and its vector, in
 * one transaction. `options.text` is the lawyer's correction made while confirming. A non-India
 * embedder is refused (and audited) before anything is saved.
 */
export async function confirmPrecedentProposal(
  deps: M5Deps,
  actor: MemoryActor,
  proposalId: string,
  options: { text?: string } = {},
): Promise<ConfirmedPrecedent> {
  const role = await requireRole(deps, actor);
  if (!canWriteMemory(role)) throw forbidden('This role cannot change memory');
  const open = await opener(deps, actor.workspaceId);
  const found = await inScope(deps, actor, async (tx) => {
    const [row] = await tx
      .select({
        key: memoryProposal.key,
        value: memoryProposal.proposedValueCiphertext,
        evidence: memoryProposal.evidence,
      })
      .from(memoryProposal)
      .where(
        and(
          eq(memoryProposal.workspaceId, actor.workspaceId),
          eq(memoryProposal.id, proposalId),
          eq(memoryProposal.ownerUserId, actor.userId),
          inArray(memoryProposal.status, ['proposed']),
        ),
      );
    return row;
  });
  if (found?.key !== 'M5.precedent') throw notFound('Proposal not found');
  const text = options.text ?? memoryText(open(found.value));
  const ev = found.evidence;
  const str = (k: string): string => (typeof ev[k] === 'string' ? ev[k] : '');
  const vector = await embedMemoryText(deps, actor, deps.embedder ?? localMemoryEmbedder, text);
  const sealed = await sealValue(deps, actor.workspaceId, text);
  return inScope(deps, actor, async (tx) => {
    const item = await confirmMemory(
      { ...deps, db: tx },
      actor,
      proposalId,
      options.text === undefined ? {} : { value: options.text },
    );
    const passageId = await saveConfirmedPassage(tx, actor, {
      itemId: item.id,
      courtId: str('courtId') || null,
      kind: str('kind'),
      language: str('language') || 'en',
      bodyCiphertext: sealed,
      sourceDraftVersionId: str('draftVersionId'),
      anchorId: str('anchorId'),
    });
    const [row] = await tx
      .select({ updatedAt: memoryItem.updatedAt })
      .from(memoryItem)
      .where(and(eq(memoryItem.workspaceId, actor.workspaceId), eq(memoryItem.id, item.id)));
    await writeItemEmbedding(tx, {
      workspaceId: actor.workspaceId,
      itemId: item.id,
      matterId: null,
      updatedAt: row?.updatedAt ?? nowOf(deps),
      vector,
    });
    return { item, passageId };
  });
}
