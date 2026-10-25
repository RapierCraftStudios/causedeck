// Reading memory (#72, ADR 0037). Every read goes through the scope rules of `scope.ts`: SQL
// predicate plus RLS for members, the column-scoped view `memory_item_clerk_v` for clerks (who never
// see M3, M4 or strategy-typed values), nothing for viewers. A member who paused all memory gets
// nothing back for use in an output, and `recordUsage` logs only real use.
import { schema, type Transaction } from '@causedeck/db';
import {
  MemoryForInput,
  type MemoryItem,
  type MemoryLayer,
  type MemoryUsedIn,
  type MemoryValue,
} from '@causedeck/validators';
import { and, asc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';

import { notFound } from '../shared/errors.ts';
import type { WorkspaceRole } from '../workspaces/index.ts';

import { isPausedAll, parseMemoryInput } from './propose.ts';
import {
  MEMORY_CLERK_LAYERS,
  inScope,
  nowOf,
  opener,
  readablePredicate,
  requireRole,
  withMatterScope,
  type MemoryActor,
  type MemoryDeps,
} from './scope.ts';

const { memoryItem, memoryUsage } = schema;

export type ItemRow = typeof memoryItem.$inferSelect;

/** What the UI renders as "because of your note on <date>". */
export interface MemoryCitation {
  itemId: string;
  key: string;
  layer: MemoryLayer;
  /** When the lawyer saved or last corrected the item. */
  date: Date;
  label: string;
}

export interface MemoryForOutput {
  items: MemoryItem[];
  citations: MemoryCitation[];
}

const ISO_DAY = (d: Date): string => d.toISOString().slice(0, 10);

export function memoryCitation(
  item: Pick<MemoryItem, 'id' | 'key' | 'layer' | 'updatedAt'>,
): MemoryCitation {
  return {
    itemId: item.id,
    key: item.key,
    layer: item.layer,
    date: item.updatedAt,
    label: `because of your note on ${ISO_DAY(item.updatedAt)}`,
  };
}

export function toItem(row: ItemRow, open: (ciphertext: string) => MemoryValue): MemoryItem {
  if (row.valueCiphertext === null) throw new Error('a deleted memory item has no value');
  return {
    id: row.id,
    layer: row.layer,
    key: row.key,
    scope: row.scope,
    matterId: row.matterId,
    personId: row.personId,
    value: open(row.valueCiphertext),
    sourceType: row.sourceType as MemoryItem['sourceType'],
    sourceRef: row.sourceRef,
    anchorId: row.anchorId,
    confidence: row.confidence === null ? null : Number(row.confidence),
    confirmationState: row.confirmationState,
    status: row.status,
    sharedWithChamber: row.sharedWithChamber,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface Query {
  id?: string;
  layers?: readonly MemoryLayer[];
  statuses: readonly ('active' | 'paused')[];
  matterId?: string | null | undefined;
}

type ClerkRow = {
  id: string;
  layer: MemoryLayer;
  key: string;
  scope: ItemRow['scope'];
  matter_id: string | null;
  person_id: string | null;
  owner_user_id: string;
  value_ciphertext: string | null;
  source_type: string;
  confirmation_state: ItemRow['confirmationState'];
  status: ItemRow['status'];
  strategy: boolean;
  shared_with_chamber: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  workspace_id: string;
};

const asDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

/** The items the role may read, by query: the table for members, the column-scoped view for clerks. */
async function readable(
  tx: Transaction,
  role: WorkspaceRole,
  actor: MemoryActor,
  query: Query,
): Promise<ItemRow[]> {
  if (role === 'viewer') return [];
  if (role === 'clerk') {
    const layers = (query.layers ?? MEMORY_CLERK_LAYERS).filter((l) =>
      MEMORY_CLERK_LAYERS.includes(l),
    );
    if (layers.length === 0) return [];
    const filters: SQL[] = [
      sql`workspace_id = ${actor.workspaceId}::uuid`,
      sql`layer in (${sql.join(
        layers.map((l) => sql`${l}`),
        sql`, `,
      )})`,
      sql`status in (${sql.join(
        query.statuses.map((s) => sql`${s}`),
        sql`, `,
      )})`,
      // The view holds no matter-scoped rows for a clerk (M3 is not clerk-readable); user scope is
      // narrowed to the clerk's own and chamber-shared rows.
      sql`(scope <> 'user' or shared_with_chamber or owner_user_id = ${actor.userId}::uuid)`,
    ];
    if (query.id) filters.push(sql`id = ${query.id}::uuid`);
    const rows = await tx.execute<ClerkRow>(
      sql`select * from memory_item_clerk_v where ${sql.join(filters, sql` and `)} order by created_at`,
    );
    return rows.map((r): ItemRow => ({
      id: r.id,
      layer: r.layer,
      key: r.key,
      scope: r.scope,
      matterId: r.matter_id,
      personId: r.person_id,
      ownerUserId: r.owner_user_id,
      valueCiphertext: r.value_ciphertext,
      sourceType: r.source_type,
      sourceRef: null,
      anchorId: null,
      confidence: null,
      confirmationState: r.confirmation_state,
      status: r.status,
      strategy: r.strategy,
      sharedWithChamber: r.shared_with_chamber,
      proposalId: null,
      createdAt: asDate(r.created_at),
      updatedAt: asDate(r.updated_at),
      deletedAt: null,
      workspaceId: r.workspace_id,
    }));
  }
  const filters: (SQL | undefined)[] = [
    eq(memoryItem.workspaceId, actor.workspaceId),
    inArray(memoryItem.status, [...query.statuses]),
    readablePredicate(actor.userId, query.matterId),
    query.id ? eq(memoryItem.id, query.id) : undefined,
    query.layers ? inArray(memoryItem.layer, [...query.layers]) : undefined,
  ];
  return tx
    .select()
    .from(memoryItem)
    .where(and(...filters))
    .orderBy(asc(memoryItem.createdAt));
}

/** Run a read pinned to the matter (when given), so RLS backs the predicate. */
function scoped<T>(
  deps: MemoryDeps,
  actor: MemoryActor,
  role: WorkspaceRole,
  matterId: string | null | undefined,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return inScope(
    deps,
    actor,
    (tx) => (matterId ? withMatterScope(tx, matterId, () => fn(tx)) : fn(tx)),
    role === 'clerk' ? 'clerk' : undefined,
  );
}

/** One item the actor may read (any non-deleted status), with its citation. NOT_FOUND otherwise. */
export async function getMemory(
  deps: MemoryDeps,
  actor: MemoryActor,
  itemId: string,
  options: { matterId?: string | null } = {},
): Promise<{ item: MemoryItem; citation: MemoryCitation }> {
  const role = await requireRole(deps, actor);
  const rows = await scoped(deps, actor, role, options.matterId, (tx) =>
    readable(tx, role, actor, {
      id: itemId,
      statuses: ['active', 'paused'],
      matterId: options.matterId,
    }),
  );
  const row = rows[0];
  if (row === undefined) throw notFound('Memory not found');
  const item = toItem(row, await opener(deps, actor.workspaceId));
  return { item, citation: memoryCitation(item) };
}

/**
 * Active memory for an output: the layers asked for, pinned to `matterId` (M3 needs one), with a
 * citation per item. Empty when the actor paused all memory or may not read memory.
 */
export async function memoryFor(
  deps: MemoryDeps,
  actor: MemoryActor,
  input: unknown,
): Promise<MemoryForOutput> {
  const { matterId, layers } = parseMemoryInput(MemoryForInput, input);
  const role = await requireRole(deps, actor);
  const rows = await scoped(deps, actor, role, matterId, async (tx) => {
    if (await isPausedAll(tx, actor.workspaceId, actor.userId)) return [];
    return readable(tx, role, actor, { layers, statuses: ['active'], matterId });
  });
  if (rows.length === 0) return { items: [], citations: [] };
  const open = await opener(deps, actor.workspaceId);
  const items = rows.map((row) => toItem(row, open));
  return { items, citations: items.map(memoryCitation) };
}

/** The actor's memory for management (active and paused), optionally of some layers. */
export async function listMemory(
  deps: MemoryDeps,
  actor: MemoryActor,
  options: { layers?: readonly MemoryLayer[]; matterId?: string | null } = {},
): Promise<MemoryItem[]> {
  const role = await requireRole(deps, actor);
  const rows = await scoped(deps, actor, role, options.matterId, (tx) =>
    readable(tx, role, actor, {
      statuses: ['active', 'paused'],
      matterId: options.matterId,
      ...(options.layers ? { layers: options.layers } : {}),
    }),
  );
  if (rows.length === 0) return [];
  const open = await opener(deps, actor.workspaceId);
  return rows.map((row) => toItem(row, open));
}

/**
 * Everything the actor may read that is active, as plain data. A member's export includes
 * matter-scoped items (an export is not an output, so no matter is pinned); a clerk's is the
 * clerk view, and a viewer's is empty.
 */
export async function exportMemory(deps: MemoryDeps, actor: MemoryActor): Promise<MemoryItem[]> {
  const role = await requireRole(deps, actor);
  const rows = await inScope(
    deps,
    actor,
    (tx) =>
      role === 'clerk' || role === 'viewer'
        ? readable(tx, role, actor, { statuses: ['active'] })
        : tx
            .select()
            .from(memoryItem)
            .where(
              and(
                eq(memoryItem.workspaceId, actor.workspaceId),
                eq(memoryItem.status, 'active'),
                or(
                  ne(memoryItem.scope, 'user'),
                  eq(memoryItem.sharedWithChamber, true),
                  eq(memoryItem.ownerUserId, actor.userId),
                ),
              ),
            )
            .orderBy(asc(memoryItem.createdAt)),
    role === 'clerk' ? 'clerk' : undefined,
  );
  if (rows.length === 0) return [];
  const open = await opener(deps, actor.workspaceId);
  return rows.map((row) => toItem(row, open));
}

/**
 * Log that an item influenced a brief, a draft or a match. Returns false (and logs nothing) when
 * the actor paused all memory. The item must be readable by the actor.
 */
export async function recordUsage(
  deps: MemoryDeps,
  actor: MemoryActor,
  input: {
    itemId: string;
    usedIn: MemoryUsedIn;
    outputRef?: string | null;
    matterId?: string | null;
  },
): Promise<boolean> {
  const role = await requireRole(deps, actor);
  return scoped(deps, actor, role, input.matterId, async (tx) => {
    if (await isPausedAll(tx, actor.workspaceId, actor.userId)) return false;
    const [row] = await readable(tx, role, actor, {
      id: input.itemId,
      statuses: ['active'],
      matterId: input.matterId,
    });
    if (row === undefined) throw notFound('Memory not found');
    await tx.insert(memoryUsage).values({
      workspaceId: actor.workspaceId,
      itemId: input.itemId,
      userId: actor.userId,
      usedIn: input.usedIn,
      outputRef: input.outputRef ?? null,
      usedAt: nowOf(deps),
    });
    return true;
  });
}
