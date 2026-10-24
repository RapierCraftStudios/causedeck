// Public API keys (#624): shown once and hashed at rest, scopes, revocation and expiry, the per-key
// monthly quota and one billed `api.calls` unit per request.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getUsage } from '../../usage/index.ts';
import {
  API_KEY_TOKEN_PATTERN,
  ApiKeyError,
  authenticateApiKey,
  consumeApiCall,
  createApiKey,
  hashApiKeyToken,
  listApiKeys,
  revokeApiKey,
} from '../index.ts';

async function issue(tx: Transaction, overrides: Partial<Parameters<typeof createApiKey>[1]> = {}) {
  const { a, ua } = await seedTwoTenants(tx);
  const created = await createApiKey(tx, {
    workspaceId: a.id,
    actorUserId: ua,
    name: 'CI',
    scopes: ['cases:read', 'notices:read'],
    ...overrides,
  });
  return { a, ua, ...created };
}

describe('api keys: issue and store', () => {
  it('returns the token once and stores only its hash', async () => {
    await withTestDb(async (tx) => {
      const { a, key, token } = await issue(tx);
      expect(token).toMatch(API_KEY_TOKEN_PATTERN);
      expect(token.startsWith(`cdk_${key.prefix}_`)).toBe(true);
      const [row] = await inWorkspace(tx, a.id, (s) =>
        s.select().from(schema.apiKey).where(eq(schema.apiKey.id, key.id)),
      );
      expect(row?.tokenHash).toBe(hashApiKeyToken(token));
      expect(JSON.stringify(row)).not.toContain(token);
      const listed = await listApiKeys(tx, a.id, key.createdBy);
      expect(listed.find((k) => k.id === key.id)).not.toHaveProperty('token');
    });
  });

  it('audits issuing and revoking a key', async () => {
    await withTestDb(async (tx) => {
      const { a, ua, key } = await issue(tx);
      await revokeApiKey(tx, a.id, ua, key.id);
      const actions = await inWorkspace(tx, a.id, (s) =>
        s.select({ action: schema.auditEvent.action }).from(schema.auditEvent),
      );
      const names = actions.map((r) => r.action);
      expect(names).toContain('api_key.created');
      expect(names).toContain('api_key.revoked');
    });
  });

  it('rejects unknown scopes, empty scopes and a negative quota', async () => {
    await withTestDb(async (tx) => {
      for (const overrides of [
        { scopes: ['cases:write'] },
        { scopes: [] },
        { monthlyQuota: -1 },
        { name: '   ' },
      ]) {
        await expect(issue(tx, overrides)).rejects.toBeInstanceOf(ApiKeyError);
      }
    });
  });

  it('refuses a non-member', async () => {
    await withTestDb(async (tx) => {
      const { a, ub } = await seedTwoTenants(tx);
      await expect(
        createApiKey(tx, { workspaceId: a.id, actorUserId: ub, name: 'x', scopes: ['cases:read'] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});

describe('api keys: authenticate', () => {
  it('resolves a valid token to its workspace, scopes and limits', async () => {
    await withTestDb(async (tx) => {
      const { a, ua, key, token } = await issue(tx, { monthlyQuota: 5, rateLimitPerMinute: 7 });
      expect(await authenticateApiKey(tx, token)).toEqual({
        id: key.id,
        workspaceId: a.id,
        createdBy: ua,
        scopes: ['cases:read', 'notices:read'],
        monthlyQuota: 5,
        rateLimitPerMinute: 7,
      });
    });
  });

  it('rejects malformed, unknown, revoked and expired tokens', async () => {
    await withTestDb(async (tx) => {
      const { a, ua, key, token } = await issue(tx);
      expect(await authenticateApiKey(tx, 'nope')).toBeNull();
      expect(
        await authenticateApiKey(tx, token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')),
      ).toBeNull();
      const past = new Date(Date.now() - 60_000);
      const expired = await createApiKey(tx, {
        workspaceId: a.id,
        actorUserId: ua,
        name: 'old',
        scopes: ['cases:read'],
        expiresAt: past,
      });
      expect(await authenticateApiKey(tx, expired.token)).toBeNull();
      await revokeApiKey(tx, a.id, ua, key.id);
      expect(await authenticateApiKey(tx, token)).toBeNull();
    });
  });
});

describe('api keys: quota and billing', () => {
  it('bills one api.calls per request, once per request id', async () => {
    await withTestDb(async (tx) => {
      const { a, key, token } = await issue(tx);
      const identity = await authenticateApiKey(tx, token);
      if (!identity) throw new Error('key did not authenticate');
      const ctx = { db: tx, workspaceId: a.id };
      const requestId = randomUUID();
      expect(await consumeApiCall(ctx, identity, requestId)).toEqual({ allowed: true, used: 1 });
      expect(await consumeApiCall(ctx, identity, requestId)).toEqual({ allowed: true, used: 1 });
      expect(await consumeApiCall(ctx, identity, randomUUID())).toEqual({ allowed: true, used: 2 });
      expect(await getUsage(ctx, 'api.calls')).toBe(2);
      const [row] = await inWorkspace(tx, a.id, (s) =>
        s.select().from(schema.apiKey).where(eq(schema.apiKey.id, key.id)),
      );
      expect(row?.lastUsedAt).not.toBeNull();
    });
  });

  it('stops at the monthly quota without billing the refused call', async () => {
    await withTestDb(async (tx) => {
      const { a, token } = await issue(tx, { monthlyQuota: 2 });
      const identity = await authenticateApiKey(tx, token);
      if (!identity) throw new Error('key did not authenticate');
      const ctx = { db: tx, workspaceId: a.id };
      await consumeApiCall(ctx, identity, randomUUID());
      await consumeApiCall(ctx, identity, randomUUID());
      expect(await consumeApiCall(ctx, identity, randomUUID())).toEqual({
        allowed: false,
        used: 2,
        quota: 2,
      });
      expect(await getUsage(ctx, 'api.calls')).toBe(2);
    });
  });

  it('counts the quota per key, not per workspace', async () => {
    await withTestDb(async (tx) => {
      const first = await issue(tx, { monthlyQuota: 1 });
      const second = await createApiKey(tx, {
        workspaceId: first.a.id,
        actorUserId: first.ua,
        name: 'second',
        scopes: ['cases:read'],
        monthlyQuota: 1,
      });
      const ctx = { db: tx, workspaceId: first.a.id };
      const one = await authenticateApiKey(tx, first.token);
      const two = await authenticateApiKey(tx, second.token);
      if (!one || !two) throw new Error('keys did not authenticate');
      expect((await consumeApiCall(ctx, one, randomUUID())).allowed).toBe(true);
      expect((await consumeApiCall(ctx, one, randomUUID())).allowed).toBe(false);
      expect((await consumeApiCall(ctx, two, randomUUID())).allowed).toBe(true);
    });
  });
});
