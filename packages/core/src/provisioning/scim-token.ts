// SCIM provisioning tokens (#684, part of #508). An owner issues a bearer token for the identity
// provider; only its SHA-256 is stored and the plaintext is returned once, by `createScimToken`. A
// token is `cds_<prefix>_<secret>` (32 random bytes). A SCIM request carries nothing but the token,
// so `authenticateScimToken` finds it through the owner-defined `app_scim_token_by_hash` (one row
// by unique hash, never a listing), like the public API keys.
import { createHash, randomBytes } from 'node:crypto';

import { schema, type Database, type Transaction } from '@causedeck/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { invalid, notFound, requireOwner } from '../workspaces/index.ts';

type Queryable = Database | Transaction;

const { scimToken } = schema;

export const SCIM_TOKEN_PATTERN = /^cds_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;

export function hashScimToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateScimToken(): { token: string; prefix: string } {
  const prefix = randomBytes(4).toString('hex');
  return { token: `cds_${prefix}_${randomBytes(32).toString('base64url')}`, prefix };
}

export interface ScimTokenSummary {
  id: string;
  name: string;
  prefix: string;
  createdBy: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

const summaryColumns = {
  id: scimToken.id,
  name: scimToken.name,
  prefix: scimToken.prefix,
  createdBy: scimToken.createdBy,
  createdAt: scimToken.createdAt,
  expiresAt: scimToken.expiresAt,
  revokedAt: scimToken.revokedAt,
  lastUsedAt: scimToken.lastUsedAt,
};

export interface CreateScimTokenInput {
  workspaceId: string;
  /** The issuing member; only owners may issue a token. */
  actorUserId: string;
  name: string;
  expiresAt?: Date | null;
}

export interface CreatedScimToken {
  token: ScimTokenSummary;
  /** The only time the plaintext exists. */
  secret: string;
}

/** Issue a token (owner only). Run it inside the workspace scope. */
export async function createScimToken(
  db: Queryable,
  input: CreateScimTokenInput,
): Promise<CreatedScimToken> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 100) throw invalid('A token name is 1 to 100 characters');
  const { token: secret, prefix } = generateScimToken();
  const token = await db.transaction(async (tx) => {
    await requireOwner(tx, input.workspaceId, input.actorUserId);
    const [row] = await tx
      .insert(scimToken)
      .values({
        workspaceId: input.workspaceId,
        name,
        prefix,
        tokenHash: hashScimToken(secret),
        createdBy: input.actorUserId,
        expiresAt: input.expiresAt ?? null,
      })
      .returning(summaryColumns);
    if (!row) throw new Error('scim token insert returned no row');
    await record(
      {
        db: tx,
        workspaceId: input.workspaceId,
        actor: { userId: input.actorUserId, kind: 'user' },
      },
      { action: 'scim_token.created', target: { kind: 'scim_token', id: row.id } },
    );
    return row;
  });
  return { token, secret };
}

/** The workspace's tokens, newest first (never the secret or its hash); owners only. */
export function listScimTokens(
  db: Queryable,
  workspaceId: string,
  actorUserId: string,
): Promise<ScimTokenSummary[]> {
  return db.transaction(async (tx) => {
    await requireOwner(tx, workspaceId, actorUserId);
    return tx
      .select(summaryColumns)
      .from(scimToken)
      .where(eq(scimToken.workspaceId, workspaceId))
      .orderBy(desc(scimToken.createdAt), desc(scimToken.id));
  });
}

/** Revoke a token at once. Another workspace's id is `NOT_FOUND`; a revoked token stays revoked. */
export function revokeScimToken(
  db: Queryable,
  workspaceId: string,
  actorUserId: string,
  tokenId: string,
  now: Date = new Date(),
): Promise<ScimTokenSummary> {
  return db.transaction(async (tx) => {
    await requireOwner(tx, workspaceId, actorUserId);
    const [existing] = await tx
      .select(summaryColumns)
      .from(scimToken)
      .where(and(eq(scimToken.workspaceId, workspaceId), eq(scimToken.id, tokenId)));
    if (!existing) throw notFound('No such SCIM token');
    if (existing.revokedAt !== null) return existing;
    const [row] = await tx
      .update(scimToken)
      .set({ revokedAt: now })
      .where(
        and(
          eq(scimToken.workspaceId, workspaceId),
          eq(scimToken.id, tokenId),
          isNull(scimToken.revokedAt),
        ),
      )
      .returning(summaryColumns);
    await record(
      { db: tx, workspaceId, actor: { userId: actorUserId, kind: 'user' } },
      { action: 'scim_token.revoked', target: { kind: 'scim_token', id: tokenId } },
    );
    return row ?? existing;
  });
}

/** What a SCIM request needs once its token checks out. */
export interface ScimIdentity {
  tokenId: string;
  workspaceId: string;
}

type TokenRow = {
  id: string;
  workspace_id: string;
  expires_at: Date | string | null;
  revoked_at: Date | string | null;
};

/** The workspace behind a token, or null when it is malformed, unknown, revoked or expired. */
export async function authenticateScimToken(
  db: Queryable,
  token: string,
  now: Date = new Date(),
): Promise<ScimIdentity | null> {
  if (!SCIM_TOKEN_PATTERN.test(token)) return null;
  const [row] = await db.execute<TokenRow>(
    sql`select * from app_scim_token_by_hash(${hashScimToken(token)})`,
  );
  if (!row || row.revoked_at !== null) return null;
  if (row.expires_at !== null && new Date(row.expires_at) <= now) return null;
  return { tokenId: row.id, workspaceId: row.workspace_id };
}
