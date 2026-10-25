// Memory seed fixtures (#72): one row per memory table for a workspace, written inside that
// workspace's scope. The two-tenant fixture and the memory tests use them. Values are opaque
// placeholders: the rows are never decrypted, so no workspace key is needed.
import { sql } from 'drizzle-orm';

import type { Transaction } from '../client.ts';
import { EMBEDDING_DIMENSIONS } from '../vector.ts';
import {
  memoryEmbedding,
  memoryItem,
  memoryPause,
  memoryProposal,
  memoryUsage,
} from '../schema/memory.ts';

export interface MemoryFixtureCtx {
  workspaceId: string;
  /** The member the rows belong to. */
  ownerId: string;
  tag: string;
}

const first = <T>(rows: T[], what: string): T => {
  const row = rows[0];
  if (row === undefined) throw new Error(`${what}: insert returned no row`);
  return row;
};

/** A confirmed, active M2 item of `ownerId`, user scope. */
export async function seedMemoryItem(
  tx: Transaction,
  { workspaceId, ownerId, tag }: MemoryFixtureCtx,
): Promise<{ id: string }> {
  const rows = await tx
    .insert(memoryItem)
    .values({
      workspaceId,
      layer: 'M2',
      key: 'M2.always_carry',
      scope: 'user',
      ownerUserId: ownerId,
      valueCiphertext: `seed-ciphertext-${tag}`,
      sourceType: 'manual',
      confirmationState: 'confirmed',
    })
    .returning({ id: memoryItem.id });
  return { id: first(rows, 'memory_item').id };
}

export async function seedMemoryProposal(
  tx: Transaction,
  { workspaceId, ownerId, tag }: MemoryFixtureCtx,
): Promise<{ id: string }> {
  const rows = await tx
    .insert(memoryProposal)
    .values({
      workspaceId,
      layer: 'M2',
      key: 'M2.brief_format',
      scope: 'user',
      ownerUserId: ownerId,
      proposedValueCiphertext: `seed-ciphertext-${tag}`,
      sourceType: 'ai',
    })
    .returning({ id: memoryProposal.id });
  return { id: first(rows, 'memory_proposal').id };
}

/** An embedding row for a fresh item (the embedding needs a parent item). */
export async function seedMemoryEmbedding(
  tx: Transaction,
  ctx: MemoryFixtureCtx,
): Promise<{ itemId: string; id: string }> {
  const { id: itemId } = await seedMemoryItem(tx, ctx);
  const vector = `[${Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;
  const rows = await tx
    .insert(memoryEmbedding)
    .values({
      workspaceId: ctx.workspaceId,
      itemId,
      contentRef: `item:${itemId}`,
      embedding: sql`${vector}::vector` as unknown as number[],
    })
    .returning({ id: memoryEmbedding.id });
  return { itemId, id: first(rows, 'memory_embedding').id };
}

export async function seedMemoryUsage(
  tx: Transaction,
  ctx: MemoryFixtureCtx,
): Promise<{ itemId: string; id: string }> {
  const { id: itemId } = await seedMemoryItem(tx, ctx);
  const rows = await tx
    .insert(memoryUsage)
    .values({
      workspaceId: ctx.workspaceId,
      itemId,
      userId: ctx.ownerId,
      usedIn: 'brief',
      outputRef: `brief-${ctx.tag}`,
    })
    .returning({ id: memoryUsage.id });
  return { itemId, id: first(rows, 'memory_usage').id };
}

export async function seedMemoryPause(
  tx: Transaction,
  { workspaceId, ownerId }: MemoryFixtureCtx,
): Promise<{ id: string }> {
  const rows = await tx
    .insert(memoryPause)
    .values({ workspaceId, userId: ownerId })
    .returning({ id: memoryPause.id });
  return { id: first(rows, 'memory_pause').id };
}
