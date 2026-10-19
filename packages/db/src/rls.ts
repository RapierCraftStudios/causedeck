// Tenancy scopes per transaction (#19, spike §4.1, docs/engineering/tenancy.md). Row-level security
// policies (0005_rls_baseline) read two transaction-local settings:
//   app.workspace_id  pinned by `withWorkspace`; tenant rows of that workspace only.
//   app.user_id       the acting user; `withUser` pins it alone for pre-workspace flows (the
//                     switcher, membership checks), where policies expose only the user's own
//                     memberships and their workspaces.
// Settings use `set_config(..., true)`, so a pooled connection reused later carries nothing. A scope
// opened on a transaction is a savepoint whose settings are restored on exit, because a setting made
// inside a released savepoint would otherwise survive until the outer COMMIT. The active scope is
// also tracked per async call chain, so nesting a different workspace (or dropping to a wider scope)
// inside a workspace throws `TENANCY_VIOLATION` instead of silently switching tenants.
import { AsyncLocalStorage } from 'node:async_hooks';

import { is, sql } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

import type { Database, Transaction } from './client.ts';
import { GLOBAL_TABLES } from './conventions.ts';

export interface WorkspaceScope {
  workspaceId: string;
  userId?: string;
}

export interface UserScope {
  userId: string;
}

/** The scope a transaction was opened with, as seen by code running inside it. */
export interface TenancyScope {
  kind: 'workspace' | 'user' | 'global';
  workspaceId: string | null;
  userId: string | null;
}

export type Queryable = Database | Transaction;

export const TENANCY_VIOLATION = 'TENANCY_VIOLATION' as const;

/** A scope change that would cross tenants: never retried, never shown to the user as-is. */
export class TenancyError extends Error {
  readonly code = TENANCY_VIOLATION;

  constructor(message: string) {
    super(message);
    this.name = 'TenancyError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

const active = new AsyncLocalStorage<TenancyScope>();

/** The scope of the innermost `withWorkspace` / `withUser` / `withoutWorkspace` running now. */
export function currentScope(): TenancyScope | undefined {
  return active.getStore();
}

interface Settings {
  ws: string;
  uid: string;
}

async function applySettings(tx: Transaction, { ws, uid }: Settings): Promise<void> {
  await tx.execute(
    sql`select set_config('app.workspace_id', ${ws}, true), set_config('app.user_id', ${uid}, true)`,
  );
}

/**
 * Open a transaction (or a savepoint on `db` when it already is one) with `settings`, run `fn` in
 * `scope`, and on a savepoint put the outer settings back before releasing it.
 */
async function scoped<T>(
  db: Queryable,
  scope: TenancyScope,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const settings = { ws: scope.workspaceId ?? '', uid: scope.userId ?? '' };
  const nested = is(db, PgTransaction);
  return db.transaction(async (tx) => {
    let previous: Settings | undefined;
    if (nested) {
      const [row] = await tx.execute<{ ws: string | null; uid: string | null }>(
        sql`select current_setting('app.workspace_id', true) as ws, current_setting('app.user_id', true) as uid`,
      );
      previous = { ws: row?.ws ?? '', uid: row?.uid ?? '' };
    }
    await applySettings(tx, settings);
    const result = await active.run(scope, () => fn(tx));
    if (previous) await applySettings(tx, previous);
    return result;
  });
}

/**
 * Run `fn` in a transaction scoped to one workspace. The settings are transaction-local
 * (`set_config(..., true)`), so a pooled connection reused later carries no workspace. Nested inside
 * another workspace's scope it throws `TENANCY_VIOLATION`; the same workspace nests freely.
 */
export async function withWorkspace<T>(
  db: Queryable,
  { workspaceId, userId }: WorkspaceScope,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!isUuid(workspaceId)) throw new TypeError('withWorkspace: workspaceId must be a uuid');
  if (userId !== undefined && !isUuid(userId)) {
    throw new TypeError('withWorkspace: userId must be a uuid');
  }
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw new TenancyError('withWorkspace: nested inside a different workspace');
  }
  if (outer?.kind === 'global') {
    throw new TenancyError('withWorkspace: nested inside withoutWorkspace');
  }
  return scoped(db, { kind: 'workspace', workspaceId, userId: userId ?? null }, fn);
}

/**
 * Run `fn` in a transaction that knows only the acting user: no workspace is pinned, so tenant rows
 * are invisible except the user's own memberships (`member_self`) and the workspaces they belong to.
 * For pre-workspace flows (switcher, membership checks); it cannot widen a workspace scope.
 */
export async function withUser<T>(
  db: Queryable,
  { userId }: UserScope,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!isUuid(userId)) throw new TypeError('withUser: userId must be a uuid');
  const outer = currentScope();
  if (outer !== undefined && outer.kind !== 'user') {
    throw new TenancyError(`withUser: nested inside a ${outer.kind} scope`);
  }
  return scoped(db, { kind: 'user', workspaceId: null, userId }, fn);
}

export interface GlobalScope {
  /** The global tables `fn` touches; each must be in GLOBAL_TABLES. */
  tables: readonly string[];
}

/**
 * @internal Admin and maintenance code only (lint-enforced: packages/db, apps/admin, migrations).
 * Runs `fn` with no workspace and no user pinned, for global tables only: tenant tables stay
 * invisible under FORCE RLS whatever `fn` does. Tenant-wide maintenance uses an owner-defined
 * function instead (e.g. `app_purge_job_effects`).
 */
export async function withoutWorkspace<T>(
  db: Queryable,
  { tables }: GlobalScope,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const globals = new Set(GLOBAL_TABLES);
  const denied = tables.filter((t) => !globals.has(t));
  if (tables.length === 0 || denied.length > 0) {
    throw new TenancyError(
      `withoutWorkspace: only allow-listed global tables (got ${denied.join(', ') || 'none'})`,
    );
  }
  if (currentScope() !== undefined) {
    throw new TenancyError('withoutWorkspace: nested inside a tenancy scope');
  }
  return scoped(db, { kind: 'global', workspaceId: null, userId: null }, fn);
}
