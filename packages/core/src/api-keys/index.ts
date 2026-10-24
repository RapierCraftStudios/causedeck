// Public API keys (#624, #487 part 1). A workspace owner or advocate issues keys; only the SHA-256
// of a token is stored and the plaintext is returned once, by `createApiKey`. A token is
// `cdk_<prefix>_<secret>` (32 random bytes): `authenticateApiKey` hashes it and reads the key through
// the owner-defined `app_api_key_by_hash`, because the workspace is not known before the key is.
// Scopes, a per-month call quota and a per-minute rate limit travel on the key; `consumeApiCall`
// enforces the quota and bills one `api.calls` usage unit per request, idempotent per request id.
import { createHash, randomBytes } from 'node:crypto';

import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { increment, usagePeriod, type UsageContext } from '../usage/index.ts';
import { requireCan } from '../workspaces/index.ts';

type Queryable = Database | Transaction;

const { apiKey, usageEvent } = schema;

export const API_KEY_SCOPES = [
  'cases:read',
  'causelists:read',
  'orders:read',
  'notices:read',
  'webhooks:write',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

/** The metered key one billed API call increments. */
export const API_CALLS_USAGE_KEY = 'api.calls' as const;

export const API_KEY_TOKEN_PATTERN = /^cdk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;
export const DEFAULT_API_KEY_RATE_LIMIT_PER_MINUTE = 60;

export class ApiKeyError extends Error {
  constructor(
    readonly reason: 'INVALID' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

export function hashApiKeyToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateApiKeyToken(): { token: string; prefix: string } {
  const prefix = randomBytes(4).toString('hex');
  return { token: `cdk_${prefix}_${randomBytes(32).toString('base64url')}`, prefix };
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  monthlyQuota: number | null;
  rateLimitPerMinute: number;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

const summaryColumns = {
  id: apiKey.id,
  name: apiKey.name,
  prefix: apiKey.prefix,
  scopes: apiKey.scopes,
  monthlyQuota: apiKey.monthlyQuota,
  rateLimitPerMinute: apiKey.rateLimitPerMinute,
  createdBy: apiKey.createdBy,
  createdAt: apiKey.createdAt,
  expiresAt: apiKey.expiresAt,
  revokedAt: apiKey.revokedAt,
  lastUsedAt: apiKey.lastUsedAt,
};

export interface CreateApiKeyInput {
  workspaceId: string;
  /** The member issuing the key; it must be allowed `workspace.manage`. */
  actorUserId: string;
  name: string;
  scopes: readonly string[];
  /** Billed calls per IST month; omit for unlimited. */
  monthlyQuota?: number | null;
  rateLimitPerMinute?: number;
  expiresAt?: Date | null;
}

export interface CreatedApiKey {
  key: ApiKeySummary;
  /** The only time the plaintext token exists. */
  token: string;
}

/** Issue a key. Throws `ApiKeyError` INVALID for bad input and `FORBIDDEN` for a non-manager. */
export async function createApiKey(
  db: Queryable,
  input: CreateApiKeyInput,
): Promise<CreatedApiKey> {
  const name = input.name.trim();
  const scopes = [...new Set(input.scopes)];
  if (name.length === 0 || name.length > 100) {
    throw new ApiKeyError('INVALID', 'A key name is 1 to 100 characters.');
  }
  if (scopes.length === 0 || !scopes.every(isApiKeyScope)) {
    throw new ApiKeyError('INVALID', 'Scopes must be a non-empty list of known scopes.');
  }
  const monthlyQuota = input.monthlyQuota ?? null;
  if (monthlyQuota !== null && (!Number.isSafeInteger(monthlyQuota) || monthlyQuota < 0)) {
    throw new ApiKeyError('INVALID', 'The monthly quota must be a non-negative integer.');
  }
  const rateLimitPerMinute = input.rateLimitPerMinute ?? DEFAULT_API_KEY_RATE_LIMIT_PER_MINUTE;
  if (
    !Number.isInteger(rateLimitPerMinute) ||
    rateLimitPerMinute < 1 ||
    rateLimitPerMinute > 10_000
  ) {
    throw new ApiKeyError('INVALID', 'The rate limit is 1 to 10000 requests per minute.');
  }
  const { token, prefix } = generateApiKeyToken();
  const key = await withWorkspace(
    db,
    { workspaceId: input.workspaceId, userId: input.actorUserId },
    async (tx) => {
      await requireCan(tx, input.workspaceId, input.actorUserId, 'workspace.manage');
      const [row] = await tx
        .insert(apiKey)
        .values({
          workspaceId: input.workspaceId,
          name,
          prefix,
          tokenHash: hashApiKeyToken(token),
          scopes,
          monthlyQuota,
          rateLimitPerMinute,
          createdBy: input.actorUserId,
          expiresAt: input.expiresAt ?? null,
        })
        .returning(summaryColumns);
      if (!row) throw new Error('api key insert returned no row');
      await record(
        {
          db: tx,
          workspaceId: input.workspaceId,
          actor: { userId: input.actorUserId, kind: 'user' },
        },
        {
          action: 'api_key.created',
          target: { kind: 'api_key', id: row.id },
          metadata: { scopes: scopes.join(',') },
        },
      );
      return row;
    },
  );
  return { key, token };
}

/** The workspace's keys, newest first (never the token or its hash). */
export function listApiKeys(
  db: Queryable,
  workspaceId: string,
  actorUserId: string,
): Promise<ApiKeySummary[]> {
  return withWorkspace(db, { workspaceId, userId: actorUserId }, async (tx) => {
    await requireCan(tx, workspaceId, actorUserId, 'workspace.manage');
    return tx
      .select(summaryColumns)
      .from(apiKey)
      .where(eq(apiKey.workspaceId, workspaceId))
      .orderBy(desc(apiKey.createdAt), desc(apiKey.id));
  });
}

/** Revoke a key at once. Another workspace's id is `NOT_FOUND`; a revoked key stays revoked. */
export function revokeApiKey(
  db: Queryable,
  workspaceId: string,
  actorUserId: string,
  keyId: string,
  now: Date = new Date(),
): Promise<ApiKeySummary> {
  return withWorkspace(db, { workspaceId, userId: actorUserId }, async (tx) => {
    await requireCan(tx, workspaceId, actorUserId, 'workspace.manage');
    const [existing] = await tx
      .select(summaryColumns)
      .from(apiKey)
      .where(and(eq(apiKey.workspaceId, workspaceId), eq(apiKey.id, keyId)));
    if (!existing) throw new ApiKeyError('NOT_FOUND', 'No such API key.');
    if (existing.revokedAt !== null) return existing;
    const [row] = await tx
      .update(apiKey)
      .set({ revokedAt: now })
      .where(
        and(eq(apiKey.workspaceId, workspaceId), eq(apiKey.id, keyId), isNull(apiKey.revokedAt)),
      )
      .returning(summaryColumns);
    await record(
      { db: tx, workspaceId, actor: { userId: actorUserId, kind: 'user' } },
      { action: 'api_key.revoked', target: { kind: 'api_key', id: keyId } },
    );
    return row ?? existing;
  });
}

/** What the API needs to serve a request made with a valid key. */
export interface ApiKeyIdentity {
  id: string;
  workspaceId: string;
  /** The member who issued the key; requests run as them, so leaving the workspace ends the key. */
  createdBy: string;
  scopes: readonly string[];
  monthlyQuota: number | null;
  rateLimitPerMinute: number;
}

type KeyRow = {
  id: string;
  workspace_id: string;
  created_by: string;
  scopes: string[];
  monthly_quota: number | null;
  rate_limit_per_minute: number;
  expires_at: Date | string | null;
  revoked_at: Date | string | null;
};

/** The key behind a token, or null when it is malformed, unknown, revoked or expired. */
export async function authenticateApiKey(
  db: Queryable,
  token: string,
  now: Date = new Date(),
): Promise<ApiKeyIdentity | null> {
  if (!API_KEY_TOKEN_PATTERN.test(token)) return null;
  const [row] = await db.execute<KeyRow>(
    sql`select * from app_api_key_by_hash(${hashApiKeyToken(token)})`,
  );
  if (!row || row.revoked_at !== null) return null;
  if (row.expires_at !== null && new Date(row.expires_at) <= now) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    scopes: row.scopes,
    monthlyQuota: row.monthly_quota,
    rateLimitPerMinute: row.rate_limit_per_minute,
  };
}

/** The user row of the member who issued a key, as the API's principal needs it; null if gone. */
export async function findApiKeyIssuer(db: Queryable, userId: string) {
  const [row] = await db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      image: schema.user.image,
      locale: schema.user.locale,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return row ?? null;
}

export type ApiCallResult =
  { allowed: true; used: number } | { allowed: false; used: number; quota: number };

/** Calls billed to `keyId` in the IST month of `at` (counted from the usage ledger). */
export function apiKeyCallsThisPeriod(ctx: UsageContext, keyId: string, at: Date): Promise<number> {
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId }, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(usageEvent)
      .where(
        and(
          eq(usageEvent.workspaceId, ctx.workspaceId),
          eq(usageEvent.key, API_CALLS_USAGE_KEY),
          sql`${usageEvent.metadata}->>'api_key_id' = ${keyId}`,
          gte(usageEvent.createdAt, usagePeriod(at).start),
        ),
      );
    return row?.n ?? 0;
  });
}

/**
 * Enforce the key's monthly quota, then bill one `api.calls` unit (idempotent per `requestId`, so a
 * retried request is not billed twice) and stamp `last_used_at`. A key at its quota is not billed.
 */
export async function consumeApiCall(
  ctx: UsageContext,
  identity: ApiKeyIdentity,
  requestId: string,
): Promise<ApiCallResult> {
  const at = ctx.now?.() ?? new Date();
  const used = await apiKeyCallsThisPeriod(ctx, identity.id, at);
  if (identity.monthlyQuota !== null && used >= identity.monthlyQuota) {
    return { allowed: false, used, quota: identity.monthlyQuota };
  }
  const { applied } = await increment(ctx, API_CALLS_USAGE_KEY, 1, {
    idempotencyKey: `api.call:${requestId}`,
    metadata: { api_key_id: identity.id },
    at,
  });
  await withWorkspace(ctx.db, { workspaceId: ctx.workspaceId }, (tx) =>
    tx
      .update(apiKey)
      .set({ lastUsedAt: at })
      .where(and(eq(apiKey.workspaceId, ctx.workspaceId), eq(apiKey.id, identity.id))),
  );
  return { allowed: true, used: used + (applied ? 1 : 0) };
}
