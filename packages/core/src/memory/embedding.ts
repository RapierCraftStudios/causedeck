// Matter-scoped memory embeddings (#72, ADR 0038). Only M3 (matter memory) is embedded, so a
// similarity search can be pinned to one matter. What is stored is the vector and a content
// reference (item id and update time), never the text. The AI gateway has no embedding task yet, so
// the vector comes from an injected `MemoryEmbedder`: the default is the in-process hashing embedder
// (mock provider in CI, nothing leaves the process); a provider-backed embedder is accepted only if
// it runs in India, and never for a sensitive matter. No memory content is used for training.
import { createHash } from 'node:crypto';

import { EMBEDDING_DIMENSIONS, schema, withWorkspace } from '@causedeck/db';
import { and, eq, sql } from 'drizzle-orm';

import { forbidden, invalid, notFound } from '../shared/errors.ts';

import {
  inScope,
  opener,
  readablePredicate,
  requireRole,
  withMatterScope,
  type Db,
  type MemoryActor,
  type MemoryDeps,
} from './scope.ts';

const { memoryItem, memoryEmbedding, matter } = schema;

export interface MemoryEmbedder {
  /** `local` runs in this process; `india` is a provider in an India region; `other` is refused. */
  readonly region: 'local' | 'india' | 'other';
  embed(text: string): Promise<number[]>;
}

/** A deterministic bag-of-words hashing embedder, unit length. Used as the mock provider. */
export const localMemoryEmbedder: MemoryEmbedder = {
  region: 'local',
  embed(text) {
    const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    for (const word of text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)) {
      const digest = createHash('sha256').update(word).digest();
      const index = digest.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
      vector[index] = (vector[index] ?? 0) + ((digest[4] ?? 0) % 2 === 0 ? 1 : -1);
    }
    const norm = Math.hypot(...vector) || 1;
    return Promise.resolve(vector.map((v) => v / norm));
  },
};

const literal = (vector: number[]): string => `[${vector.join(',')}]`;

function assertEmbedderAllowed(embedder: MemoryEmbedder, sensitiveMatter: boolean): void {
  if (embedder.region === 'other') {
    throw forbidden('Memory content is never sent to a provider outside India');
  }
  if (embedder.region !== 'local' && sensitiveMatter) {
    throw forbidden('Memory of a sensitive matter is not sent to a provider');
  }
}

/** Embed one matter-scoped item, replacing its earlier vector. Returns false for a non-M3 item. */
export async function embedMemoryItem(
  deps: MemoryDeps,
  actor: MemoryActor,
  itemId: string,
  matterId: string,
  embedder: MemoryEmbedder = localMemoryEmbedder,
): Promise<boolean> {
  await requireRole(deps, actor);
  const open = await opener(deps, actor.workspaceId);
  return inScope(deps, actor, (tx) =>
    withMatterScope(tx, matterId, async () => {
      const [row] = await tx
        .select({ item: memoryItem, sensitive: matter.sensitive })
        .from(memoryItem)
        .innerJoin(
          matter,
          and(eq(matter.workspaceId, memoryItem.workspaceId), eq(matter.id, memoryItem.matterId)),
        )
        .where(
          and(
            eq(memoryItem.workspaceId, actor.workspaceId),
            eq(memoryItem.id, itemId),
            eq(memoryItem.status, 'active'),
            readablePredicate(actor.userId, matterId),
          ),
        );
      if (row === undefined) throw notFound('Memory not found');
      if (
        row.item.layer !== 'M3' ||
        row.item.matterId === null ||
        row.item.valueCiphertext === null
      ) {
        return false;
      }
      assertEmbedderAllowed(embedder, row.sensitive);
      const value = open(row.item.valueCiphertext);
      const vector = await embedder.embed(
        typeof value === 'string' ? value : JSON.stringify(value),
      );
      if (vector.length !== EMBEDDING_DIMENSIONS) throw invalid('Embedding has the wrong size');
      await tx
        .delete(memoryEmbedding)
        .where(
          and(
            eq(memoryEmbedding.workspaceId, actor.workspaceId),
            eq(memoryEmbedding.itemId, itemId),
          ),
        );
      await tx.execute(sql`
        insert into memory_embedding (workspace_id, item_id, matter_id, content_ref, embedding)
        values (${actor.workspaceId}::uuid, ${itemId}::uuid, ${row.item.matterId}::uuid,
                ${`item:${itemId}@${row.item.updatedAt.toISOString()}`}, ${literal(vector)}::vector)`);
      return true;
    }),
  );
}

/** The ids of the items nearest to `query` inside one matter (cosine distance, active items only). */
export async function searchMatterMemory(
  deps: MemoryDeps,
  actor: MemoryActor,
  matterId: string,
  query: string,
  limit = 5,
  embedder: MemoryEmbedder = localMemoryEmbedder,
): Promise<string[]> {
  const role = await requireRole(deps, actor);
  if (role === 'viewer' || role === 'clerk') return [];
  assertEmbedderAllowed(embedder, false);
  const vector = literal(await embedder.embed(query));
  return inScope(deps, actor, (tx) =>
    withMatterScope(tx, matterId, async () => {
      const rows = await tx.execute<{ item_id: string }>(sql`
        select e.item_id::text as item_id
        from memory_embedding e
        join memory_item i on i.workspace_id = e.workspace_id and i.id = e.item_id
        where e.workspace_id = ${actor.workspaceId}::uuid and e.matter_id = ${matterId}::uuid
          and i.status = 'active'
        order by e.embedding <=> ${vector}::vector
        limit ${limit}`);
      return rows.map((r) => r.item_id);
    }),
  );
}

/**
 * Delete the embeddings of every deleted item of the workspace. Idempotent; the `memory.purge`
 * sweep runs it hourly, so a deleted item's vectors are gone within 24 h.
 */
export async function purgeDeletedMemoryEmbeddings(db: Db, workspaceId: string): Promise<number> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      delete from memory_embedding e
      using memory_item i
      where e.workspace_id = ${workspaceId}::uuid and i.workspace_id = e.workspace_id
        and i.id = e.item_id and i.status = 'deleted'
      returning e.id::text as id`);
    return rows.length;
  });
}

/** Workspaces that hold embeddings of deleted items (ids only, through the owner-defined function). */
export async function purgeMemoryTargets(db: Db): Promise<string[]> {
  const rows = await db.execute<{ workspace_id: string }>(
    sql`select workspace_id::text as workspace_id from app_memory_purge_targets()`,
  );
  return rows.map((r) => r.workspace_id);
}
