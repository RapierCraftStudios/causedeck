// Saving and changing memory (#72, ADR 0037). `confirmMemory` is the only path that turns a
// proposal into a `memory_item`, and `createMemoryNote` the only other writer of a new item: a note the
// lawyer wrote themselves. Values are sealed with the workspace key (`sealValue`, `encryptField`
// with AAD = workspace id) before they reach a row, and a delete removes the value at once; the
// embeddings of a deleted item are removed by the `memory.purge` sweep inside 24 h.
import { schema, type Transaction } from '@causedeck/db';
import {
  isMemoryKey,
  isStrategyKey,
  layerOfKey,
  MemoryNoteInput,
  MemoryPatch,
  type MemoryItem,
} from '@causedeck/validators';
import { and, eq, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { conflict, forbidden, invalid, notFound } from '../shared/errors.ts';
import type { WorkspaceRole } from '../workspaces/index.ts';

import { guard, isPausedAll, parseMemoryInput, proposeMemory } from './propose.ts';
import { toItem, type ItemRow } from './read.ts';
import {
  assertClientOrContact,
  assertMatterExists,
  canWriteMemory,
  inScope,
  nowOf,
  opener,
  readablePredicate,
  requireRole,
  sealValue,
  strategyOf,
  type MemoryActor,
  type MemoryDeps,
} from './scope.ts';

const { memoryItem, memoryProposal, memoryEmbedding, memoryPause } = schema;

async function requireWriter(deps: MemoryDeps, actor: MemoryActor): Promise<WorkspaceRole> {
  const role = await requireRole(deps, actor);
  if (!canWriteMemory(role)) throw forbidden('This role cannot change memory');
  return role;
}

/** The item the actor may change: visible under the scope rules, and theirs (or an owner's to manage). */
async function loadMutable(
  tx: Transaction,
  actor: MemoryActor,
  role: WorkspaceRole,
  itemId: string,
  matterId: string | null | undefined,
): Promise<ItemRow> {
  const [row] = await tx
    .select()
    .from(memoryItem)
    .where(
      and(
        eq(memoryItem.workspaceId, actor.workspaceId),
        eq(memoryItem.id, itemId),
        sql`${memoryItem.status} <> 'deleted'`,
        readablePredicate(actor.userId, matterId),
      ),
    );
  if (row === undefined) throw notFound('Memory not found');
  if (row.ownerUserId !== actor.userId && !(role === 'owner' && row.scope !== 'user')) {
    throw forbidden('Only the author can change this memory');
  }
  return row;
}

/**
 * Turn a proposal into a saved item. `options.value` is the lawyer's correction made while
 * confirming; the item is then `corrected`. Only the proposal's owner can confirm it.
 */
export async function confirmMemory(
  deps: MemoryDeps,
  actor: MemoryActor,
  proposalId: string,
  options: { value?: unknown } = {},
): Promise<MemoryItem> {
  await requireWriter(deps, actor);
  const corrected =
    options.value === undefined
      ? undefined
      : parseMemoryInput(MemoryPatch, { value: options.value }).value;
  const now = nowOf(deps);
  const sealedCorrection =
    corrected === undefined ? undefined : await sealValue(deps, actor.workspaceId, corrected);
  const open = await opener(deps, actor.workspaceId);
  return inScope(deps, actor, async (tx) => {
    const [proposal] = await tx
      .select()
      .from(memoryProposal)
      .where(
        and(
          eq(memoryProposal.workspaceId, actor.workspaceId),
          eq(memoryProposal.id, proposalId),
          eq(memoryProposal.ownerUserId, actor.userId),
          eq(memoryProposal.status, 'proposed'),
        ),
      )
      .for('update');
    if (proposal === undefined) throw notFound('Proposal not found');
    if (await isPausedAll(tx, actor.workspaceId, actor.userId)) {
      throw conflict('Memory is paused: resume it before saving');
    }
    if (!isMemoryKey(proposal.key)) throw invalid('Not a registered memory key');
    guard(proposal.key, corrected ?? open(proposal.proposedValueCiphertext));
    if (proposal.matterId) await assertMatterExists(tx, actor.workspaceId, proposal.matterId);
    if (proposal.personId) await assertClientOrContact(tx, actor.workspaceId, proposal.personId);
    const [row] = await tx
      .insert(memoryItem)
      .values({
        workspaceId: actor.workspaceId,
        layer: proposal.layer,
        key: proposal.key,
        scope: proposal.scope,
        matterId: proposal.matterId,
        personId: proposal.personId,
        ownerUserId: proposal.ownerUserId,
        valueCiphertext: sealedCorrection ?? proposal.proposedValueCiphertext,
        sourceType: proposal.sourceType,
        sourceRef: proposal.sourceRef,
        anchorId: proposal.anchorId,
        confidence: proposal.confidence,
        confirmationState: corrected === undefined ? 'confirmed' : 'corrected',
        strategy: isStrategyKey(proposal.key),
        proposalId: proposal.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('memory item insert returned no row');
    await tx
      .update(memoryProposal)
      .set({ status: 'confirmed', decidedAt: now })
      .where(
        and(eq(memoryProposal.workspaceId, actor.workspaceId), eq(memoryProposal.id, proposal.id)),
      );
    return toItem(row, open);
  });
}

/** The lawyer declined a proposal; it is not proposed again for 60 days. */
export async function dismissMemoryProposal(
  deps: MemoryDeps,
  actor: MemoryActor,
  proposalId: string,
): Promise<void> {
  await requireWriter(deps, actor);
  const now = nowOf(deps);
  await inScope(deps, actor, async (tx) => {
    const rows = await tx
      .update(memoryProposal)
      .set({ status: 'dismissed', decidedAt: now })
      .where(
        and(
          eq(memoryProposal.workspaceId, actor.workspaceId),
          eq(memoryProposal.id, proposalId),
          eq(memoryProposal.ownerUserId, actor.userId),
          eq(memoryProposal.status, 'proposed'),
        ),
      )
      .returning({ id: memoryProposal.id });
    if (rows.length === 0) throw notFound('Proposal not found');
  });
}

/** A note the lawyer wrote: saved at once, `manual`, confirmed. */
export async function createMemoryNote(
  deps: MemoryDeps,
  actor: MemoryActor,
  input: unknown,
): Promise<MemoryItem> {
  const parsed = parseMemoryInput(MemoryNoteInput, input);
  if (!isMemoryKey(parsed.key)) throw invalid('Not a registered memory key');
  const layer = layerOfKey(parsed.key);
  guard(parsed.key, parsed.value);
  await requireWriter(deps, actor);
  const now = nowOf(deps);
  const sealed = await sealValue(deps, actor.workspaceId, parsed.value);
  const open = await opener(deps, actor.workspaceId);
  return inScope(deps, actor, async (tx) => {
    if (parsed.matterId) await assertMatterExists(tx, actor.workspaceId, parsed.matterId);
    if (parsed.personId) await assertClientOrContact(tx, actor.workspaceId, parsed.personId);
    const [row] = await tx
      .insert(memoryItem)
      .values({
        workspaceId: actor.workspaceId,
        layer,
        key: parsed.key,
        scope: parsed.scope,
        matterId: parsed.matterId ?? null,
        personId: parsed.personId ?? null,
        ownerUserId: actor.userId,
        valueCiphertext: sealed,
        sourceType: 'manual',
        confirmationState: 'confirmed',
        strategy: strategyOf(parsed.key),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('memory item insert returned no row');
    return toItem(row, open);
  });
}

/**
 * Accepting a `memory_item` automation draft: the draft payload becomes a proposal, which is then
 * confirmed by the person who accepted it. This is the same confirm path as any other proposal.
 */
export async function acceptMemoryDraft(
  deps: MemoryDeps,
  actor: MemoryActor,
  payload: unknown,
): Promise<MemoryItem> {
  const proposal = await proposeMemory(deps, actor, payload);
  if (proposal === null) throw conflict('Memory is paused: resume it before saving');
  return confirmMemory(deps, actor, proposal.id);
}

/** Replace an item's value (the item becomes `corrected`); its embeddings are dropped as stale. */
export async function editMemory(
  deps: MemoryDeps,
  actor: MemoryActor,
  itemId: string,
  patch: unknown,
  options: { matterId?: string | null } = {},
): Promise<MemoryItem> {
  const { value } = parseMemoryInput(MemoryPatch, patch);
  const role = await requireWriter(deps, actor);
  const now = nowOf(deps);
  const sealed = await sealValue(deps, actor.workspaceId, value);
  const open = await opener(deps, actor.workspaceId);
  return inScope(deps, actor, async (tx) => {
    const current = await loadMutable(tx, actor, role, itemId, options.matterId);
    guard(current.key, value);
    const [row] = await tx
      .update(memoryItem)
      .set({ valueCiphertext: sealed, confirmationState: 'corrected', updatedAt: now })
      .where(and(eq(memoryItem.workspaceId, actor.workspaceId), eq(memoryItem.id, itemId)))
      .returning();
    if (!row) throw new Error('memory item update returned no row');
    await tx
      .delete(memoryEmbedding)
      .where(
        and(eq(memoryEmbedding.workspaceId, actor.workspaceId), eq(memoryEmbedding.itemId, itemId)),
      );
    return toItem(row, open);
  });
}

/** Pause (or resume) one item: a paused item is kept but never used in an output. */
export async function pauseMemory(
  deps: MemoryDeps,
  actor: MemoryActor,
  itemId: string,
  paused = true,
  options: { matterId?: string | null } = {},
): Promise<void> {
  const role = await requireWriter(deps, actor);
  const now = nowOf(deps);
  await inScope(deps, actor, async (tx) => {
    await loadMutable(tx, actor, role, itemId, options.matterId);
    await tx
      .update(memoryItem)
      .set({ status: paused ? 'paused' : 'active', updatedAt: now })
      .where(and(eq(memoryItem.workspaceId, actor.workspaceId), eq(memoryItem.id, itemId)));
  });
}

/**
 * Delete one item: its value is removed now (the row stays as a tombstone for usage history). Its
 * embeddings are purged by the `memory.purge` sweep, which runs hourly, so they are gone inside 24 h.
 */
export async function deleteMemory(
  deps: MemoryDeps,
  actor: MemoryActor,
  itemId: string,
  options: { matterId?: string | null } = {},
): Promise<void> {
  const role = await requireWriter(deps, actor);
  const now = nowOf(deps);
  await inScope(deps, actor, async (tx) => {
    await loadMutable(tx, actor, role, itemId, options.matterId);
    await tx
      .update(memoryItem)
      .set({
        status: 'deleted',
        valueCiphertext: null,
        sharedWithChamber: false,
        deletedAt: now,
        updatedAt: now,
      })
      .where(and(eq(memoryItem.workspaceId, actor.workspaceId), eq(memoryItem.id, itemId)));
  });
}

/**
 * Share an M4 court note with the chamber, or make it private again. Owner role only, and audited
 * (`memory.sharing_changed`, ids only); a non-owner cannot flip it.
 */
export async function setSharedWithChamber(
  deps: MemoryDeps,
  actor: MemoryActor,
  itemId: string,
  shared: boolean,
): Promise<void> {
  const role = await requireRole(deps, actor);
  if (role !== 'owner') throw forbidden('Only an owner can share a court note with the chamber');
  const now = nowOf(deps);
  await inScope(deps, actor, async (tx) => {
    const current = await loadMutable(tx, actor, role, itemId, null);
    if (current.layer !== 'M4')
      throw invalid('Only a court note (M4) can be shared with the chamber');
    await tx
      .update(memoryItem)
      .set({ sharedWithChamber: shared, updatedAt: now })
      .where(and(eq(memoryItem.workspaceId, actor.workspaceId), eq(memoryItem.id, itemId)));
    await record(
      { db: tx, workspaceId: actor.workspaceId, actor: { userId: actor.userId, kind: 'user' } },
      {
        action: 'memory.sharing_changed',
        target: { kind: 'memory_item', id: itemId },
        metadata: { shared },
      },
    );
  });
}

/** The per-member "pause all memory" switch: while on, no proposal is filed and no memory is used. */
export async function setMemoryPauseAll(
  deps: MemoryDeps,
  actor: MemoryActor,
  paused: boolean,
): Promise<boolean> {
  await requireRole(deps, actor);
  const now = nowOf(deps);
  await inScope(deps, actor, async (tx) => {
    if (paused) {
      await tx
        .insert(memoryPause)
        .values({ workspaceId: actor.workspaceId, userId: actor.userId, pausedAt: now })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(memoryPause)
        .where(
          and(eq(memoryPause.workspaceId, actor.workspaceId), eq(memoryPause.userId, actor.userId)),
        );
    }
  });
  return paused;
}

/** Whether the actor paused all memory. */
export async function isMemoryPaused(deps: MemoryDeps, actor: MemoryActor): Promise<boolean> {
  await requireRole(deps, actor);
  return inScope(deps, actor, (tx) => isPausedAll(tx, actor.workspaceId, actor.userId));
}
