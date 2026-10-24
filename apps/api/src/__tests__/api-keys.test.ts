// API keys through the real app (#624): a key resolves to a principal, scopes and the public-path
// allowlist are enforced, the per-key rate limit and monthly quota answer 429, and each call is
// billed as one `api.calls` unit.
import { createApiKey, revokeApiKey } from '@causedeck/core/api-keys';
import { getUsage } from '@causedeck/core/usage';
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { afterAll, describe, expect, it } from 'vitest';

import { defineRoute, requireScope, type AppRouter } from '../lib/openapi.ts';

import { call, createWorkspace, makeApp, problemOf, signIn } from './helpers.ts';

afterAll(closeTestDb);

function withProbeRoutes(v1: AppRouter): void {
  v1.openapi(
    defineRoute({
      method: 'get',
      path: '/cases/probe/ping',
      middleware: [requireScope('cases:read')],
      responses: { 200: { description: 'Probe' } },
    }),
    (c) => c.json({ ok: true }, 200),
  );
  v1.openapi(
    defineRoute({
      method: 'get',
      path: '/orders/probe/ping',
      middleware: [requireScope('orders:read')],
      responses: { 200: { description: 'Probe' } },
    }),
    (c) => c.json({ ok: true }, 200),
  );
}

async function issue(options: { monthlyQuota?: number; rateLimitPerMinute?: number } = {}) {
  const user = await signIn();
  const workspace = await createWorkspace(user.id, 'owner');
  const { key, token } = await createApiKey(testAppDb(), {
    workspaceId: workspace.id,
    actorUserId: user.id,
    name: 'integration',
    scopes: ['cases:read'],
    ...options,
  });
  return { user, workspace, key, token };
}

describe('API key bearer tokens', () => {
  it('rejects an unknown or malformed key with 401', async () => {
    const app = makeApp({ routes: withProbeRoutes });
    expect((await call(app, '/v1/cases/probe/ping', { bearer: 'cdk_00000000_nope' })).status).toBe(
      401,
    );
    const unknown = `cdk_00000000_${'A'.repeat(43)}`;
    expect((await call(app, '/v1/cases/probe/ping', { bearer: unknown })).status).toBe(401);
  });

  it('serves a key with the scope and bills one api.calls per call', async () => {
    const { workspace, token } = await issue();
    const app = makeApp({ routes: withProbeRoutes });
    for (let i = 1; i <= 2; i += 1) {
      const response = await call(app, '/v1/cases/probe/ping', { bearer: token });
      expect(response.status).toBe(200);
      expect(response.headers.get('x-quota-used')).toBe(String(i));
    }
    expect(await getUsage({ db: testAppDb(), workspaceId: workspace.id }, 'api.calls')).toBe(2);
  });

  it('answers 403 for a missing scope and for routes outside the public API', async () => {
    const { token } = await issue();
    const app = makeApp({ routes: withProbeRoutes });
    expect((await call(app, '/v1/orders/probe/ping', { bearer: token })).status).toBe(403);
    const me = await call(app, '/v1/me', { bearer: token });
    expect(me.status).toBe(403);
    expect((await problemOf(me)).code).toBe('FORBIDDEN');
  });

  it('refuses another workspace by header', async () => {
    const { token } = await issue();
    const other = await issue();
    const app = makeApp({ routes: withProbeRoutes });
    const response = await call(app, '/v1/cases/probe/ping', {
      bearer: token,
      headers: { 'x-workspace-id': other.workspace.id },
    });
    expect(response.status).toBe(403);
  });

  it('stops serving a revoked key', async () => {
    const { user, workspace, key, token } = await issue();
    const app = makeApp({ routes: withProbeRoutes });
    expect((await call(app, '/v1/cases/probe/ping', { bearer: token })).status).toBe(200);
    await revokeApiKey(testAppDb(), workspace.id, user.id, key.id);
    expect((await call(app, '/v1/cases/probe/ping', { bearer: token })).status).toBe(401);
  });

  it('enforces the monthly quota with 429 and does not bill the refused call', async () => {
    const { workspace, token } = await issue({ monthlyQuota: 1 });
    const app = makeApp({ routes: withProbeRoutes });
    expect((await call(app, '/v1/cases/probe/ping', { bearer: token })).status).toBe(200);
    const refused = await call(app, '/v1/cases/probe/ping', { bearer: token });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('x-quota-limit')).toBe('1');
    expect(await getUsage({ db: testAppDb(), workspaceId: workspace.id }, 'api.calls')).toBe(1);
  });

  it('enforces the per-key rate limit and does not bill limited calls', async () => {
    const { workspace, token } = await issue({ rateLimitPerMinute: 2 });
    const app = makeApp({ routes: withProbeRoutes });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await call(app, '/v1/cases/probe/ping', { bearer: token })).status);
    }
    expect(statuses).toEqual([200, 200, 429, 429]);
    expect(await getUsage({ db: testAppDb(), workspaceId: workspace.id }, 'api.calls')).toBe(2);
  });
});
