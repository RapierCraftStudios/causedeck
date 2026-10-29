// Read models of the memory screen (#73): the member's pending proposals, where an item was used,
// each item's last use, and the items the monthly review offers. All run in the actor's workspace
// scope through the scope rules of `read.ts` (`listMemory`, `getMemory`), so what the role may not
// read is never returned; a proposal is only ever its owner's.
import { schema } from '@causedeck/db';
import type { MemoryItem, MemoryLayer, MemoryProposal } from '@causedeck/validators';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { toProposal } from './propose.ts';
import { getMemory, listMemory } from './read.ts';
import {
  canWriteMemory,
  inScope,
  nowOf,
  opener,
  requireRole,
  type MemoryActor,
  type MemoryDeps,
} from './scope.ts';

const { memoryProposal, memoryUsage } = schema;

/** The registry key of the review date; it is bookkeeping, never shown as a memory card. */
export const MEMORY_REVIEW_KEY = 'M1.last_memory_review';
/** The monthly review offers an active item not confirmed, edited or used for this long. */
export const MEMORY_REVIEW_AFTER_DAYS = 60;

export interface MemoryListItem extends MemoryItem {
  /** The latest use in a brief, draft or match; null when it was never used. */
  lastUsedAt: Date | null;
}

export interface MemoryUsageEntry {
  id: string;
  usedIn: 'brief' | 'draft' | 'matching';
  outputRef: string | null;
  usedAt: Date;
}

/** The actor's pending proposals (theirs only), newest first. Empty for a role that cannot write. */
export async function listMemoryProposals(
  deps: MemoryDeps,
  actor: MemoryActor,
): Promise<MemoryProposal[]> {
  const role = await requireRole(deps, actor);
  if (!canWriteMemory(role)) return [];
  const open = await opener(deps, actor.workspaceId);
  const rows = await inScope(deps, actor, (tx) =>
    tx
      .select()
      .from(memoryProposal)
      .where(
        and(
          eq(memoryProposal.workspaceId, actor.workspaceId),
          eq(memoryProposal.ownerUserId, actor.userId),
          eq(memoryProposal.status, 'proposed'),
        ),
      )
      .orderBy(desc(memoryProposal.proposedAt)),
  );
  return rows.map((row) => toProposal(row, open));
}

/** Where one item influenced output, newest first. NOT_FOUND unless the actor may read the item. */
export async function listMemoryUsage(
  deps: MemoryDeps,
  actor: MemoryActor,
  itemId: string,
  options: { matterId?: string | null } = {},
): Promise<MemoryUsageEntry[]> {
  await getMemory(deps, actor, itemId, options);
  return inScope(deps, actor, (tx) =>
    tx
      .select({
        id: memoryUsage.id,
        usedIn: memoryUsage.usedIn,
        outputRef: memoryUsage.outputRef,
        usedAt: memoryUsage.usedAt,
      })
      .from(memoryUsage)
      .where(and(eq(memoryUsage.workspaceId, actor.workspaceId), eq(memoryUsage.itemId, itemId)))
      .orderBy(desc(memoryUsage.usedAt))
      .limit(20),
  );
}

/** The actor's memory for the screen (active and paused) with each item's last use. */
export async function listMemoryWithUsage(
  deps: MemoryDeps,
  actor: MemoryActor,
  options: { layers?: readonly MemoryLayer[]; matterId?: string | null } = {},
): Promise<MemoryListItem[]> {
  const items = (await listMemory(deps, actor, options)).filter((i) => i.key !== MEMORY_REVIEW_KEY);
  if (items.length === 0) return [];
  const last = await inScope(deps, actor, (tx) =>
    tx
      .select({ itemId: memoryUsage.itemId, usedAt: sql<Date>`max(${memoryUsage.usedAt})` })
      .from(memoryUsage)
      .where(
        and(
          eq(memoryUsage.workspaceId, actor.workspaceId),
          inArray(
            memoryUsage.itemId,
            items.map((i) => i.id),
          ),
        ),
      )
      .groupBy(memoryUsage.itemId),
  );
  const byItem = new Map(last.map((r) => [r.itemId, new Date(r.usedAt)]));
  return items.map((i) => ({ ...i, lastUsedAt: byItem.get(i.id) ?? null }));
}

/** Active items with no confirmation, edit or use in the last 60 days: keep, edit or delete. */
export async function listReviewCandidates(
  deps: MemoryDeps,
  actor: MemoryActor,
): Promise<MemoryListItem[]> {
  const cutoff = nowOf(deps).getTime() - MEMORY_REVIEW_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const items = await listMemoryWithUsage(deps, actor);
  return items.filter(
    (i) =>
      i.status === 'active' &&
      Math.max(i.updatedAt.getTime(), i.lastUsedAt?.getTime() ?? 0) < cutoff,
  );
}
