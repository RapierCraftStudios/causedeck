// Memory embeddings (#72, ADR 0044; M5 #901, ADR 0046). M3 (matter memory) is embedded per matter, so
// a similarity search can be pinned to one matter; M5 precedent passages are embedded with no matter
// (`writeItemEmbedding`, used by `m5/precedent-bank.ts`). What is stored is the vector and a content
// reference (item id and update time), never the text. The AI gateway has no embedding task yet, so
// the vector comes from an injected `MemoryEmbedder`: the default is the in-process hashing embedder
// (mock provider in CI, nothing leaves the process); a provider-backed embedder is accepted only if
// it runs in India, and never for a sensitive matter. No memory content is used for training.
import { createHash } from 'node:crypto';

import { EMBEDDING_DIMENSIONS, schema, withWorkspace, type Transaction } from '@causedeck/db';
import { and, eq, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';
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
  /** Names the embedder in the audit event when it is refused. */
  readonly id?: string;
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

/**
 * Refuse an embedder outside India, and audit the refusal (`memory.embedding_refused`, embedder id
 * only). Call it outside the transaction that would embed: a refusal must not roll its audit back.
 */
export async function refuseForeignEmbedder(
  deps: MemoryDeps,
  actor: MemoryActor,
  embedder: MemoryEmbedder,
): Promise<void> {
  if (embedder.region !== 'other') return;
  await record(
    { db: deps.db, workspaceId: actor.workspaceId, actor: { userId: actor.userId, kind: 'user' } },
    {
      action: 'memory.embedding_refused',
      metadata: { embedder: embedder.id ?? 'unknown', reason: 'outside_india' },
    },
  );
  throw forbidden('Memory content is never sent to a provider outside India');
}

/** Embed text on the India-only route; the vector has the registered size. */
export async function embedMemoryText(
  deps: MemoryDeps,
  actor: MemoryActor,
  embedder: MemoryEmbedder,
  text: string,
): Promise<number[]> {
  await refuseForeignEmbedder(deps, actor, embedder);
  const vector = await embedder.embed(text);
  if (vector.length !== EMBEDDING_DIMENSIONS) throw invalid('Embedding has the wrong size');
  return vector;
}

/** Replace the vector of one item (`matterId` null for an M5 passage). Returns nothing. */
export async function writeItemEmbedding(
  tx: Transaction,
  input: {
    workspaceId: string;
    itemId: string;
    matterId: string | null;
    updatedAt: Date;
    vector: number[];
  },
): Promise<void> {
  await tx
    .delete(memoryEmbedding)
    .where(
      and(
        eq(memoryEmbedding.workspaceId, input.workspaceId),
        eq(memoryEmbedding.itemId, input.itemId),
      ),
    );
  await tx.execute(sql`
    insert into memory_embedding (workspace_id, item_id, matter_id, content_ref, embedding)
    values (${input.workspaceId}::uuid, ${input.itemId}::uuid, ${input.matterId}::uuid,
            ${`item:${input.itemId}@${input.updatedAt.toISOString()}`}, ${literal(input.vector)}::vector)`);
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
  await refuseForeignEmbedder(deps, actor, embedder);
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
      await writeItemEmbedding(tx, {
        workspaceId: actor.workspaceId,
        itemId,
        matterId: row.item.matterId,
        updatedAt: row.item.updatedAt,
        vector,
      });
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
  await refuseForeignEmbedder(deps, actor, embedder);
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
