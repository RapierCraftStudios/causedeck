// Workspace and membership queries for the API (#14) and later the web app. Every query is
// filtered by the calling user's id, so a caller can only ever see their own memberships, and
// skips soft-deleted workspaces and non-active (suspended or removed) memberships (#177). They run
// before a workspace is selected, so outside a tenancy scope they open the user-only scope
// (`withUser`, #19): row-level security then exposes only the user's own memberships.
import { currentScope, schema, withUser, type Database, type Transaction } from '@causedeck/db';
import { and, asc, eq, is, sql } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

import { activeMember, liveWorkspace } from './members.ts';

export * from './errors.ts';
export * from './invitations.ts';
export * from './members.ts';
export * from './offboarding.ts';
export * from './service.ts';
export * from './slug.ts';

export type Queryable = Database | Transaction;

/**
 * `fn` on the caller's scoped transaction, or in a new user-only scope. The root client inside a
 * workspace scope would query on another connection with no scope, so `withUser` rejects it.
 */
function asUser<T>(db: Queryable, userId: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return currentScope() !== undefined && is(db, PgTransaction)
    ? fn(db)
    : withUser(db, { userId }, fn);
}

export type WorkspaceRole = (typeof schema.member.$inferSelect)['role'];

export interface MembershipSummary {
  workspaceId: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  createdAt: Date;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export interface PageRequest {
  limit: number;
  cursor?: string | undefined;
}

/** A cursor that does not decode; the API maps it to a 422 `VALIDATION` error on `cursor`. */
export class InvalidCursorError extends Error {
  readonly code = 'INVALID_CURSOR' as const;

  constructor() {
    super('Invalid cursor');
    this.name = 'InvalidCursorError';
  }
}

interface WorkspaceCursor {
  /** `created_at` as Postgres text, so microseconds survive (a JS Date would truncate them). */
  createdAt: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PG_TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:\d{2})?|Z)$/;

/** Opaque keyset cursor over `(created_at, id)`. */
export function encodeWorkspaceCursor(cursor: WorkspaceCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString('base64url');
}

export function decodeWorkspaceCursor(value: string): WorkspaceCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw new InvalidCursorError();
  const [createdAt, id] = parsed as unknown[];
  if (typeof createdAt !== 'string' || !PG_TIMESTAMPTZ.test(createdAt)) {
    throw new InvalidCursorError();
  }
  if (typeof id !== 'string' || !UUID.test(id)) throw new InvalidCursorError();
  return { createdAt, id };
}

/** Every workspace the user belongs to, with their role, oldest membership first. */
export async function listMemberships(db: Queryable, userId: string): Promise<MembershipSummary[]> {
  return asUser(db, userId, (tx) =>
    tx
      .select({
        workspaceId: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(and(eq(schema.member.userId, userId), activeMember, liveWorkspace))
      .orderBy(asc(schema.member.createdAt), asc(schema.member.id)),
  );
}

/** One page of the user's workspaces, ordered by workspace creation. */
export async function listWorkspacesForUser(
  db: Queryable,
  userId: string,
  { limit, cursor }: PageRequest,
): Promise<Page<WorkspaceSummary>> {
  const after = cursor === undefined ? undefined : decodeWorkspaceCursor(cursor);
  const rows = await asUser(db, userId, (tx) =>
    tx
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        role: schema.member.role,
        createdAt: schema.organization.createdAt,
        createdAtText: sql<string>`${schema.organization.createdAt}::text`,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(
        and(
          eq(schema.member.userId, userId),
          activeMember,
          liveWorkspace,
          after &&
            sql`(${schema.organization.createdAt}, ${schema.organization.id}) > (${after.createdAt}::timestamptz, ${after.id}::uuid)`,
        ),
      )
      .orderBy(asc(schema.organization.createdAt), asc(schema.organization.id))
      .limit(limit + 1),
  );

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? encodeWorkspaceCursor({ createdAt: last.createdAtText, id: last.id })
      : null;
  const data = page.map(({ id, name, slug, role, createdAt }) => ({
    id,
    name,
    slug,
    role,
    createdAt,
  }));
  return { data, nextCursor };
}

/** The user's role in the workspace, or `null` when they are not an active member of a live one. */
export async function memberRole(
  db: Queryable,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const [row] = await asUser(db, userId, (tx) =>
    tx
      .select({ role: schema.member.role })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(
        and(
          eq(schema.member.userId, userId),
          eq(schema.member.organizationId, workspaceId),
          activeMember,
          liveWorkspace,
        ),
      )
      .limit(1),
  );
  return row?.role ?? null;
}
