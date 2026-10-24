// Cross-tenant REST routes (#19, #209): user `ub` (workspace B) never sees or reaches workspace A
// through `/v1`. Users sign in through Better Auth (committed), and the two-tenant fixture seeds a
// row in every tenant table of A and B. A probe route behind `requireWorkspace` reads every tenant
// table through `c.var.withWorkspace`: B gets 403 for A's id (same as an unknown id), A's members
// get A's rows only. Every `/v1` route must be listed in ROUTES below.
import { randomUUID } from 'node:crypto';

import { createApiKey } from '@causedeck/core/api-keys';
import { createRoute, z } from '@hono/zod-openapi';
import type { Transaction } from '@causedeck/db';
import {
  closeTestDb,
  registeredTenantTables,
  schema,
  testAppDb,
  withWorkspace,
} from '@causedeck/db/testing';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defineRoute, type AppRouter } from '../lib/openapi.ts';
import { requireWorkspace } from '../middleware/workspace.ts';

import { call, makeApp, problemOf, signIn, type TestUser } from './helpers.ts';

afterAll(closeTestDb);

/** Every built-in `/v1` route and how this file covers it. */
const ROUTES: Record<string, string> = {
  'GET /v1/me': 'memberships list only the caller’s workspaces',
  'GET /v1/workspaces': 'never lists another user’s workspace',
  'GET /v1/billing/plans': 'global catalogue only, no tenant data',
  'GET /v1/billing/subscription': 'B gets 403 for A’s id and only its own subscription',
  'GET /v1/cases/:cnr':
    'own workspace only; another workspace’s case is a 404 (public-api.test.ts)',
  'GET /v1/causelists':
    'shared non-personal lists, no workspace data; advocate narrows to own watches (public-api.test.ts)',
  'GET /v1/orders':
    'own case or shared non-personal orders; another workspace’s case gives none (public-api.test.ts)',
  'GET /v1/notices': 'global non-personal notices, no tenant fields (public-api.test.ts)',
  'GET /v1/workspaces/:workspaceId/matters/:matterId/bench-card':
    'flag-gated 404 when off; workspace membership checked; reads under the workspace scope (bench-card.test.ts)',
  'POST /v1/webhooks/razorpay':
    'signature-gated; workspace from the stored provider id only (razorpay-webhook.test.ts)',
  'GET /v1/webhook-endpoints':
    'a key or session of B lists only B’s endpoints; A’s never appear; a session naming A is 403 (this file)',
  'POST /v1/webhook-endpoints':
    'the workspace is the key’s own (or the member-checked header), never the body; B’s create lands in B only (this file)',
  'DELETE /v1/webhook-endpoints/:id':
    'B’s key or session cannot delete A’s endpoint: 404 and the row survives (this file)',
  'POST /v1/inbound/email':
    'provider-verified; the workspace comes only from the resolved intake address (inbound-email.test.ts)',
};

const PROBE_PATHS = new Set(['/v1/xt-probe', '/v1/workspaces/:workspaceId/xt-probe']);

async function visibleWorkspaces(run: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>) {
  return run(async (tx) => {
    const ids = new Set<string>();
    for (const table of registeredTenantTables()) {
      const rows = await tx.execute<{ ws: string }>(
        sql.raw(`select distinct workspace_id::text as ws from "${table}"`),
      );
      for (const row of rows) ids.add(row.ws);
    }
    return [...ids].sort();
  });
}

function withProbe(v1: AppRouter): void {
  v1.openapi(
    defineRoute({
      method: 'get',
      path: '/xt-probe',
      middleware: [requireWorkspace(testAppDb())],
      responses: { 200: { description: 'Probe' } },
    }),
    async (c) => c.json({ visible: await visibleWorkspaces(c.var.withWorkspace) }, 200),
  );
  v1.openapi(
    createRoute({
      method: 'get',
      path: '/workspaces/{workspaceId}/xt-probe',
      security: [{ sessionCookie: [] }],
      middleware: [requireWorkspace(testAppDb())],
      request: { params: z.object({ workspaceId: z.string() }) },
      responses: { 200: { description: 'Probe by path' } },
    }),
    async (c) => c.json({ visible: await visibleWorkspaces(c.var.withWorkspace) }, 200),
  );
}

let ua: TestUser;
let ub: TestUser;
let uboth: TestUser;
let t: TwoTenants;

beforeAll(async () => {
  [ua, ub, uboth] = [await signIn(), await signIn(), await signIn()];
  t = await seedTwoTenants(testAppDb(), { users: { ua: ua.id, ub: ub.id, uboth: uboth.id } });
});

describe('cross-tenant REST routes', () => {
  it('lists every /v1 route in this file', () => {
    const app = makeApp();
    const v1 = [
      ...new Set(
        app.routes
          .filter((r) => r.path.startsWith('/v1/') && r.method !== 'ALL')
          .map((r) => `${r.method} ${r.path}`),
      ),
    ].sort();
    expect(v1).toEqual(Object.keys(ROUTES).sort());
  });

  it('GET /v1/me: B sees only its own memberships', async () => {
    const response = await call(makeApp(), '/v1/me', { cookie: ub.cookie });
    expect(response.status).toBe(200);
    const body = JSON.stringify(await response.json());
    expect(body).toContain(t.b.id);
    expect(body).not.toContain(t.a.id);
    expect(body).not.toContain(t.a.slug);
  });

  it('GET /v1/workspaces: B never sees A', async () => {
    const response = await call(makeApp(), '/v1/workspaces?limit=100', { cookie: ub.cookie });
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as { data: { id: string }[] };
    expect(data.map((w) => w.id)).toEqual([t.b.id]);
  });

  it('GET /v1/billing/subscription: B gets 403 for A and only its own subscription', async () => {
    const app = makeApp();
    const denied = await call(app, '/v1/billing/subscription', {
      cookie: ub.cookie,
      headers: { 'x-workspace-id': t.a.id },
    });
    expect(denied.status).toBe(403);
    const own = await call(app, '/v1/billing/subscription', {
      cookie: ub.cookie,
      headers: { 'x-workspace-id': t.b.id },
    });
    expect(own.status).toBe(200);
    const { subscription } = (await own.json()) as { subscription: { id: string } | null };
    expect(subscription).not.toBeNull();
    const [aSubscription] = await withWorkspace(testAppDb(), { workspaceId: t.a.id }, (tx) =>
      tx.select({ id: schema.subscription.id }).from(schema.subscription),
    );
    expect(subscription?.id).not.toBe(aSubscription?.id);
  });

  it('GET /v1/billing/plans returns the catalogue only', async () => {
    const response = await call(makeApp(), '/v1/billing/plans', { cookie: ub.cookie });
    expect(response.status).toBe(200);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain(t.a.id);
    expect(body).not.toContain(t.b.id);
  });

  it('POST /v1/webhooks/razorpay rejects an unsigned call without touching any workspace', async () => {
    const response = await call(makeApp(), '/v1/webhooks/razorpay', {
      method: 'POST',
      rawBody: JSON.stringify({ event: 'subscription.cancelled', payload: {}, created_at: 0 }),
      headers: { 'x-razorpay-event-id': `evt_${randomUUID()}` },
    });
    expect(response.status).toBe(400);
  });

  it('a workspace route with A’s id is 403 for B, by header and by path, like an unknown id', async () => {
    const app = makeApp({ routes: withProbe });
    for (const workspaceId of [t.a.id, randomUUID()]) {
      const byHeader = await call(app, '/v1/xt-probe', {
        cookie: ub.cookie,
        headers: { 'x-workspace-id': workspaceId },
      });
      expect(byHeader.status).toBe(403);
      expect((await problemOf(byHeader)).code).toBe('FORBIDDEN');
      const byPath = await call(app, `/v1/workspaces/${workspaceId}/xt-probe`, {
        cookie: ub.cookie,
      });
      expect(byPath.status).toBe(403);
      // The path wins over a header naming B's own workspace.
      const mixed = await call(app, `/v1/workspaces/${workspaceId}/xt-probe`, {
        cookie: ub.cookie,
        headers: { 'x-workspace-id': t.b.id },
      });
      expect(mixed.status).toBe(403);
    }
  });

  it('members see only their workspace’s rows; uboth sees each workspace on its own', async () => {
    const app = makeApp({ routes: withProbe });
    const cases: [TestUser, string][] = [
      [ua, t.a.id],
      [ub, t.b.id],
      [uboth, t.a.id],
      [uboth, t.b.id],
    ];
    for (const [user, workspaceId] of cases) {
      const response = await call(app, `/v1/workspaces/${workspaceId}/xt-probe`, {
        cookie: user.cookie,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ visible: [workspaceId] });
    }
  });

  describe('/v1/webhook-endpoints', () => {
    const endpointIds = (workspaceId: string) =>
      withWorkspace(testAppDb(), { workspaceId }, (tx) =>
        tx.select({ id: schema.webhookEndpoint.id }).from(schema.webhookEndpoint),
      ).then((rows) => rows.map((r) => r.id));

    const keyFor = async (workspaceId: string, actorUserId: string) =>
      (
        await createApiKey(testAppDb(), {
          workspaceId,
          actorUserId,
          name: 'xt-webhooks',
          scopes: ['webhooks:write'],
        })
      ).token;

    it('GET: A’s endpoints never appear in B’s list, by key or by session', async () => {
      const app = makeApp();
      const aIds = await endpointIds(t.a.id);
      expect(aIds.length).toBeGreaterThan(0);
      const keyB = await keyFor(t.b.id, ub.id);
      const byKey = await call(app, '/v1/webhook-endpoints', { bearer: keyB });
      expect(byKey.status).toBe(200);
      const listedByKey = ((await byKey.json()) as { data: { id: string }[] }).data.map(
        (e) => e.id,
      );
      expect(listedByKey.sort()).toEqual((await endpointIds(t.b.id)).sort());
      for (const id of aIds) expect(listedByKey).not.toContain(id);

      const keyA = await keyFor(t.a.id, ua.id);
      const ownA = await call(app, '/v1/webhook-endpoints', { bearer: keyA });
      const listedA = ((await ownA.json()) as { data: { id: string }[] }).data.map((e) => e.id);
      expect(listedA.sort()).toEqual([...aIds].sort());

      const denied = await call(app, '/v1/webhook-endpoints', {
        cookie: ub.cookie,
        headers: { 'x-workspace-id': t.a.id },
      });
      expect(denied.status).toBe(403);
    });

    it('POST: B’s key creates in B only; a session naming A is 403 and writes nothing', async () => {
      const app = makeApp();
      const aBefore = (await endpointIds(t.a.id)).sort();
      const keyB = await keyFor(t.b.id, ub.id);
      const created = await call(app, '/v1/webhook-endpoints', {
        method: 'POST',
        bearer: keyB,
        // A workspace id in the body is ignored: the key's own workspace wins.
        body: { url: 'https://hooks.example.com/xt-b', workspaceId: t.a.id },
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      expect(await endpointIds(t.b.id)).toContain(id);
      expect((await endpointIds(t.a.id)).sort()).toEqual(aBefore);

      const denied = await call(app, '/v1/webhook-endpoints', {
        method: 'POST',
        cookie: ub.cookie,
        headers: { 'x-workspace-id': t.a.id },
        body: { url: 'https://hooks.example.com/xt-denied' },
      });
      expect(denied.status).toBe(403);
      expect((await endpointIds(t.a.id)).sort()).toEqual(aBefore);
    });

    it('DELETE: B cannot delete A’s endpoint by key (404) or by session (403); the row survives', async () => {
      const app = makeApp();
      const aIds = await endpointIds(t.a.id);
      const keyB = await keyFor(t.b.id, ub.id);
      for (const id of aIds) {
        const byKey = await call(app, `/v1/webhook-endpoints/${id}`, {
          method: 'DELETE',
          bearer: keyB,
        });
        expect(byKey.status).toBe(404);
        const bySession = await call(app, `/v1/webhook-endpoints/${id}`, {
          method: 'DELETE',
          cookie: ub.cookie,
          headers: { 'x-workspace-id': t.a.id },
        });
        expect(bySession.status).toBe(403);
      }
      expect((await endpointIds(t.a.id)).sort()).toEqual([...aIds].sort());
    });
  });

  it('probe routes are test-only', () => {
    const app = makeApp();
    expect(app.routes.some((r) => PROBE_PATHS.has(r.path))).toBe(false);
  });
});
