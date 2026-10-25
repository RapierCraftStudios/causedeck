// Who may read which memory (#72, ADR 0038), shared by every memory service. Scope is enforced in
// SQL first: FORCE RLS (`ws_isolation`), the owner and matter scope policies of the migration, and
// the clerk view. The predicates here repeat those rules in the query so a read never depends on
// the policy alone, and `canReadMemory` is the same rule for a row already in hand.
//   * a matter-scoped item (M3) is returned only for a pinned matter, and only that matter's
//   * a user-scope item is its owner's alone, except an M4 note its owner shared with the chamber
//   * clerks read M1, M2, M6 and M7 values that are not strategy-typed, through the view, never M3 or M4
//   * viewers read no memory
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import type { Secret } from '@causedeck/config/env';
import {
  decryptField,
  encryptField,
  ensureWorkspaceKey,
  getWorkspaceDek,
} from '@causedeck/storage';
import type { KeyProvider } from '@causedeck/storage';
import { isMemoryKey, isStrategyKey, MemoryValue, type MemoryLayer } from '@causedeck/validators';
import { and, eq, or, sql, type SQL } from 'drizzle-orm';

import { invalid, notFound } from '../shared/errors.ts';
import { memberRole, type WorkspaceRole } from '../workspaces/index.ts';

export type Db = Database | Transaction;

export interface MemoryDeps {
  db: Db;
  /** Wraps the workspace key that encrypts every memory value. */
  keys: KeyProvider;
  now?: () => Date;
}

export interface MemoryActor {
  userId: string;
  workspaceId: string;
}

export const nowOf = (deps: Pick<MemoryDeps, 'now'>): Date => (deps.now ?? (() => new Date()))();

/** Layers a clerk may read, and only when the value is not strategy-typed. */
export const MEMORY_CLERK_LAYERS: readonly MemoryLayer[] = ['M1', 'M2', 'M6', 'M7'];

export interface ReadableFacts {
  layer: MemoryLayer;
  key: string;
  scope: 'user' | 'workspace' | 'matter';
  matterId: string | null;
  ownerUserId: string;
  sharedWithChamber: boolean;
  strategy: boolean;
}

/**
 * Whether `role` (a member `userId`) may read the item, pinned to `matterId` or not. The clerk
 * rule is the policy function `memory_clerk_readable`; the others mirror the RLS policies.
 */
export function canReadMemory(
  role: WorkspaceRole,
  userId: string,
  item: ReadableFacts,
  matterId?: string | null,
): boolean {
  if (role === 'viewer') return false;
  if (item.scope === 'matter' && (matterId == null || item.matterId !== matterId)) return false;
  if (item.scope === 'user' && item.ownerUserId !== userId && !item.sharedWithChamber) return false;
  if (role === 'clerk') return MEMORY_CLERK_LAYERS.includes(item.layer) && !item.strategy;
  return true;
}

/** The query predicate equal to `canReadMemory` over `memory_item`, for a non-clerk member. */
export function readablePredicate(userId: string, matterId?: string | null): SQL {
  const { memoryItem } = schema;
  const matterOk =
    matterId == null
      ? sql`${memoryItem.scope} <> 'matter'`
      : sql`(${memoryItem.scope} <> 'matter' or ${memoryItem.matterId} = ${matterId}::uuid)`;
  const ownerOk = or(
    sql`${memoryItem.scope} <> 'user'`,
    eq(memoryItem.sharedWithChamber, true),
    eq(memoryItem.ownerUserId, userId),
  ) as SQL;
  return and(matterOk, ownerOk) as SQL;
}

/** The actor's role, or `notFound` for a non-member (never tells a stranger a workspace exists). */
export async function requireRole(deps: MemoryDeps, actor: MemoryActor): Promise<WorkspaceRole> {
  const role = await memberRole(deps.db, actor.userId, actor.workspaceId);
  if (role === null) throw notFound('Workspace not found');
  return role;
}

export const canWriteMemory = (role: WorkspaceRole): boolean =>
  role === 'owner' || role === 'advocate' || role === 'junior';

/**
 * Run `fn` with `app.matter_id` pinned in the workspace transaction, so the matter scope policies
 * apply even to a query that forgot its predicate. The previous value is restored afterwards.
 */
export function withMatterScope<T>(
  tx: Transaction,
  matterId: string | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return tx.transaction(async (inner) => {
    const [row] = await inner.execute<{ prev: string | null }>(
      sql`select current_setting('app.matter_id', true) as prev`,
    );
    await inner.execute(sql`select set_config('app.matter_id', ${matterId ?? ''}, true)`);
    try {
      return await fn();
    } finally {
      await inner.execute(sql`select set_config('app.matter_id', ${row?.prev ?? ''}, true)`);
    }
  });
}

/** Run in the actor's workspace scope (the user id feeds the owner scope policy). */
export function inScope<T>(
  deps: MemoryDeps,
  actor: MemoryActor,
  fn: (tx: Transaction) => Promise<T>,
  dbRole?: 'clerk',
): Promise<T> {
  return withWorkspace(
    deps.db,
    { workspaceId: actor.workspaceId, userId: actor.userId, ...(dbRole ? { dbRole } : {}) },
    fn,
  );
}

/** Encrypt a value with the workspace key (AAD = workspace id), creating the key on first use. */
export async function sealValue(
  deps: MemoryDeps,
  workspaceId: string,
  value: MemoryValue,
): Promise<string> {
  await ensureWorkspaceKey(deps.db, deps.keys, workspaceId);
  const dek = await getWorkspaceDek(deps.db, deps.keys, workspaceId);
  return encryptField(dek, workspaceId, JSON.stringify(value));
}

/** Decrypt values for one workspace with a single key fetch. */
export async function opener(
  deps: MemoryDeps,
  workspaceId: string,
): Promise<(ciphertext: string) => MemoryValue> {
  await ensureWorkspaceKey(deps.db, deps.keys, workspaceId);
  const dek: Secret<Buffer> = await getWorkspaceDek(deps.db, deps.keys, workspaceId);
  return (ciphertext) => {
    const parsed = MemoryValue.safeParse(JSON.parse(decryptField(dek, workspaceId, ciphertext)));
    if (!parsed.success) throw new Error('memory value does not match the value schema');
    return parsed.data;
  };
}

/** The registry's strategy flag for a key (false for an unregistered one, which is rejected anyway). */
export const strategyOf = (key: string): boolean => isMemoryKey(key) && isStrategyKey(key);

/** M6 memory is about a client or a professional contact only. */
export async function assertClientOrContact(
  tx: Transaction,
  workspaceId: string,
  personId: string,
): Promise<void> {
  const { person } = schema;
  const [row] = await tx
    .select({ kind: person.kind })
    .from(person)
    .where(and(eq(person.workspaceId, workspaceId), eq(person.id, personId)));
  if (row === undefined) throw notFound('Person not found');
  if (row.kind !== 'client' && row.kind !== 'professional') {
    throw invalid('Relationship memory is kept only for a client or a professional contact');
  }
}

/** The matter must exist in the workspace and be visible to the actor. */
export async function assertMatterExists(
  tx: Transaction,
  workspaceId: string,
  matterId: string,
): Promise<void> {
  const { matter } = schema;
  const [row] = await tx
    .select({ id: matter.id })
    .from(matter)
    .where(and(eq(matter.workspaceId, workspaceId), eq(matter.id, matterId)));
  if (row === undefined) throw notFound('Matter not found');
}
