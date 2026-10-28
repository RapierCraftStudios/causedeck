// The M5 precedent bank (#901, ADR 0046): passages from the lawyer's own exported drafts, each the
// typed side of an M5 `memory_item`. A passage exists only after a person confirmed an L2 proposal:
// `saveConfirmedPassage` (internal) refuses an item without a confirmed proposal, and it is called
// only from `confirmPrecedentProposal` in the same transaction as `confirmMemory`. Search is
// SQL-scoped: the workspace is pinned, a row is the caller's own or one an owner shared with the
// chamber, clerks and viewers are denied, and only embeddings of active items are searched. Passage
// text is sealed with the workspace key; vectors come from the India-only embedder, never trained on.
import { schema, type Transaction } from '@causedeck/db';
import { and, desc, eq, sql } from 'drizzle-orm';

import { record } from '../../audit/index.ts';
import { forbidden, notFound } from '../../shared/errors.ts';
import { deleteMemory } from '../confirm.ts';
import { embedMemoryText, localMemoryEmbedder, type MemoryEmbedder } from '../embedding.ts';
import { isPausedAll } from '../propose.ts';
import {
  canWriteMemory,
  inScope,
  nowOf,
  opener,
  readablePredicate,
  requireRole,
  type MemoryActor,
  type MemoryDeps,
} from '../scope.ts';

const { memoryItem, memoryProposal, memoryEmbedding, precedentPassage } = schema;

/** A memory value as text: a passage is a string; anything else is kept as JSON. */
export function memoryText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export interface M5Deps extends MemoryDeps {
  /** Defaults to the in-process mock; a provider embedder must run in India. */
  embedder?: MemoryEmbedder;
}

export interface PrecedentView {
  passageId: string;
  itemId: string;
  text: string;
  kind: string;
  courtId: string | null;
  language: string;
  sourceDraftVersionId: string;
  anchorId: string;
  status: 'active' | 'retired';
  sharedWithChamber: boolean;
  /** Cosine distance to the query (search only); smaller is nearer. */
  distance?: number;
}

export interface ConfirmedPassageInput {
  itemId: string;
  courtId: string | null;
  kind: string;
  language: string;
  bodyCiphertext: string;
  sourceDraftVersionId: string;
  anchorId: string;
}

/**
 * Insert the passage of a just-confirmed M5 item. Internal: it requires the item to carry a
 * confirmed proposal (`proposal_id`, status `confirmed`) owned by the actor, so no write path
 * exists without a confirmation record.
 */
export async function saveConfirmedPassage(
  tx: Transaction,
  actor: MemoryActor,
  input: ConfirmedPassageInput,
): Promise<string> {
  const [item] = await tx
    .select({ ownerUserId: memoryItem.ownerUserId, state: memoryItem.confirmationState })
    .from(memoryItem)
    .innerJoin(
      memoryProposal,
      and(
        eq(memoryProposal.workspaceId, memoryItem.workspaceId),
        eq(memoryProposal.id, memoryItem.proposalId),
      ),
    )
    .where(
      and(
        eq(memoryItem.workspaceId, actor.workspaceId),
        eq(memoryItem.id, input.itemId),
        eq(memoryItem.layer, 'M5'),
        eq(memoryItem.key, 'M5.precedent'),
        eq(memoryProposal.status, 'confirmed'),
      ),
    );
  if (item === undefined || item.ownerUserId !== actor.userId) {
    throw forbidden('A passage is saved only from a confirmed proposal');
  }
  const [row] = await tx
    .insert(precedentPassage)
    .values({
      workspaceId: actor.workspaceId,
      memoryItemId: input.itemId,
      courtId: input.courtId,
      kind: input.kind,
      language: input.language,
      bodyCiphertext: input.bodyCiphertext,
      sourceDraftVersionId: input.sourceDraftVersionId,
      anchorId: input.anchorId,
    })
    .returning({ id: precedentPassage.id });
  if (!row) throw new Error('precedent passage insert returned no row');
  return row.id;
}

async function requireReader(deps: MemoryDeps, actor: MemoryActor): Promise<void> {
  const role = await requireRole(deps, actor);
  if (!canWriteMemory(role)) throw forbidden('This role cannot read the precedent bank');
}

interface HitRow extends Record<string, unknown> {
  passage_id: string;
  item_id: string;
  court_id: string | null;
  kind: string;
  language: string;
  body_ciphertext: string;
  source_draft_version_id: string;
  anchor_id: string;
  status: 'active' | 'retired';
  shared_with_chamber: boolean;
  distance: number | null;
}

/**
 * The passages nearest to `query`: the caller's own and the chamber-shared ones, active only,
 * optionally for one court or kind. Clerks and viewers are denied; a paused member gets nothing.
 */
export async function searchPrecedents(
  deps: M5Deps,
  actor: MemoryActor,
  query: string,
  options: { courtId?: string; kind?: string; limit?: number } = {},
): Promise<PrecedentView[]> {
  await requireReader(deps, actor);
  const vector = await embedMemoryText(deps, actor, deps.embedder ?? localMemoryEmbedder, query);
  const open = await opener(deps, actor.workspaceId);
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
  return inScope(deps, actor, async (tx) => {
    if (await isPausedAll(tx, actor.workspaceId, actor.userId)) return [];
    const rows = await tx.execute<HitRow>(sql`
      select p.id::text as passage_id, p.memory_item_id::text as item_id, p.court_id::text as court_id,
             p.kind, p.language, p.body_ciphertext, p.source_draft_version_id::text as source_draft_version_id,
             p.anchor_id, p.status, i.shared_with_chamber,
             (e.embedding <=> ${`[${vector.join(',')}]`}::vector)::float8 as distance
      from memory_embedding e
      join memory_item i on i.workspace_id = e.workspace_id and i.id = e.item_id
      join precedent_passage p on p.workspace_id = i.workspace_id and p.memory_item_id = i.id
      where e.workspace_id = ${actor.workspaceId}::uuid
        and i.layer = 'M5' and i.key = 'M5.precedent' and i.status = 'active'
        and p.status = 'active'
        and (i.owner_user_id = ${actor.userId}::uuid or i.shared_with_chamber)
        ${options.courtId ? sql`and p.court_id = ${options.courtId}::uuid` : sql``}
        ${options.kind ? sql`and p.kind = ${options.kind}` : sql``}
      order by distance
      limit ${limit}`);
    return rows.map((r) => ({
      passageId: r.passage_id,
      itemId: r.item_id,
      text: memoryText(open(r.body_ciphertext)),
      kind: r.kind,
      courtId: r.court_id,
      language: r.language,
      sourceDraftVersionId: r.source_draft_version_id,
      anchorId: r.anchor_id,
      status: r.status,
      sharedWithChamber: r.shared_with_chamber,
      ...(r.distance === null ? {} : { distance: r.distance }),
    }));
  });
}

/** The passages the actor may read (own and chamber-shared), newest first; retired ones included. */
export async function listPrecedents(
  deps: MemoryDeps,
  actor: MemoryActor,
  options: { status?: 'active' | 'retired'; courtId?: string; limit?: number } = {},
): Promise<PrecedentView[]> {
  await requireReader(deps, actor);
  const open = await opener(deps, actor.workspaceId);
  return inScope(deps, actor, async (tx) => {
    const rows = await tx
      .select({ p: precedentPassage, shared: memoryItem.sharedWithChamber })
      .from(precedentPassage)
      .innerJoin(
        memoryItem,
        and(
          eq(memoryItem.workspaceId, precedentPassage.workspaceId),
          eq(memoryItem.id, precedentPassage.memoryItemId),
        ),
      )
      .where(
        and(
          eq(precedentPassage.workspaceId, actor.workspaceId),
          options.status
            ? eq(precedentPassage.status, options.status)
            : sql`${precedentPassage.status} <> 'deleted'`,
          options.courtId ? eq(precedentPassage.courtId, options.courtId) : undefined,
          eq(memoryItem.status, 'active'),
          readablePredicate(actor.userId),
        ),
      )
      .orderBy(desc(precedentPassage.createdAt))
      .limit(Math.min(Math.max(options.limit ?? 50, 1), 200));
    return rows.flatMap(({ p, shared }) =>
      p.bodyCiphertext === null || p.status === 'deleted'
        ? []
        : [
            {
              passageId: p.id,
              itemId: p.memoryItemId,
              text: memoryText(open(p.bodyCiphertext)),
              kind: p.kind,
              courtId: p.courtId,
              language: p.language,
              sourceDraftVersionId: p.sourceDraftVersionId,
              anchorId: p.anchorId,
              status: p.status,
              sharedWithChamber: shared,
            },
          ],
    );
  });
}

/** The author's own M5 item, or `notFound`; an owner role may also manage a shared one. */
async function requireManageable(
  tx: Transaction,
  deps: MemoryDeps,
  actor: MemoryActor,
  itemId: string,
): Promise<void> {
  const role = await requireRole(deps, actor);
  if (!canWriteMemory(role)) throw forbidden('This role cannot change memory');
  const [row] = await tx
    .select({ owner: memoryItem.ownerUserId, shared: memoryItem.sharedWithChamber })
    .from(memoryItem)
    .where(
      and(
        eq(memoryItem.workspaceId, actor.workspaceId),
        eq(memoryItem.id, itemId),
        eq(memoryItem.layer, 'M5'),
        sql`${memoryItem.status} <> 'deleted'`,
        readablePredicate(actor.userId),
      ),
    );
  if (row === undefined) throw notFound('Memory not found');
  if (row.owner !== actor.userId && !(role === 'owner' && row.shared)) {
    throw forbidden('Only the author can change this memory');
  }
}

/** Take a passage out of search without deleting it. */
export async function retirePrecedent(
  deps: MemoryDeps,
  actor: MemoryActor,
  itemId: string,
): Promise<void> {
  const now = nowOf(deps);
  await inScope(deps, actor, async (tx) => {
    await requireManageable(tx, deps, actor, itemId);
    const rows = await tx
      .update(precedentPassage)
      .set({ status: 'retired', updatedAt: now })
      .where(
        and(
          eq(precedentPassage.workspaceId, actor.workspaceId),
          eq(precedentPassage.memoryItemId, itemId),
          eq(precedentPassage.status, 'active'),
        ),
      )
      .returning({ id: precedentPassage.id });
    if (rows.length === 0) throw notFound('Passage not found');
  });
}

/**
 * Delete a passage: the item is marked deleted (value and body gone at once) and its vectors are
 * removed in the same transaction; the hourly `memory.purge` sweep stays the 24 h backstop.
 */
export async function deletePrecedent(
  deps: MemoryDeps,
  actor: MemoryActor,
  itemId: string,
): Promise<void> {
  const now = nowOf(deps);
  await inScope(deps, actor, async (tx) => {
    await requireManageable(tx, deps, actor, itemId);
    await deleteMemory({ ...deps, db: tx }, actor, itemId);
    await tx
      .update(precedentPassage)
      .set({ status: 'deleted', bodyCiphertext: null, updatedAt: now })
      .where(
        and(
          eq(precedentPassage.workspaceId, actor.workspaceId),
          eq(precedentPassage.memoryItemId, itemId),
        ),
      );
    await tx
      .delete(memoryEmbedding)
      .where(
        and(eq(memoryEmbedding.workspaceId, actor.workspaceId), eq(memoryEmbedding.itemId, itemId)),
      );
  });
}

/**
 * Share an M5 item (passage or playbook) with the chamber, or make it private again. Owner role
 * only, the author's own item, audited as `memory.sharing_changed` (ids only).
 */
export async function setM5Shared(
  deps: MemoryDeps,
  actor: MemoryActor,
  itemId: string,
  shared: boolean,
): Promise<void> {
  const role = await requireRole(deps, actor);
  if (role !== 'owner') throw forbidden('Only an owner can share memory with the chamber');
  const now = nowOf(deps);
  await inScope(deps, actor, async (tx) => {
    const [row] = await tx
      .select({ owner: memoryItem.ownerUserId })
      .from(memoryItem)
      .where(
        and(
          eq(memoryItem.workspaceId, actor.workspaceId),
          eq(memoryItem.id, itemId),
          eq(memoryItem.layer, 'M5'),
          eq(memoryItem.status, 'active'),
          readablePredicate(actor.userId),
        ),
      );
    if (row === undefined) throw notFound('Memory not found');
    if (row.owner !== actor.userId) throw forbidden('Only the author can share this memory');
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
