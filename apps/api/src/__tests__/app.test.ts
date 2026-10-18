// End-to-end behaviour of `createApp` over `app.request()`: health, tenancy, validation, body
// limits and headers.
import { createRoute, z } from '@hono/zod-openapi';
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { defineRoute, principalOf, type AppRouter } from '../lib/openapi.ts';
import { requireWorkspace } from '../middleware/workspace.ts';

import { addMember, call, createWorkspace, makeApp, problemOf, signIn } from './helpers.ts';

afterAll(closeTestDb);

describe('health', () => {
  it('serves /healthz from @causedeck/observability without touching dependencies', async () => {
    const response = await call(makeApp(), '/healthz');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('serves /readyz with a db check, 503 when a check fails', async () => {
    const ready = await call(makeApp(), '/readyz');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: 'ok', checks: { db: { ok: true } } });

    const failing = makeApp({ readyChecks: { storage: () => Promise.reject(new Error('down')) } });
    const notReady = await call(failing, '/readyz');
    expect(notReady.status).toBe(503);
    const body = (await notReady.json()) as { checks: Record<string, { ok: boolean }> };
    expect(body.checks.storage?.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain('down');
  });
});

describe('GET /v1/workspaces', () => {
  it('lists both workspaces of a user in two, and nothing of anyone else', async () => {
    const alice = await signIn();
    const bob = await signIn();
    const a1 = await createWorkspace(alice.id, 'owner');
    const a2 = await createWorkspace(alice.id, 'junior');
    const b1 = await createWorkspace(bob.id, 'owner');
    const app = makeApp();

    const response = await call(app, '/v1/workspaces', { cookie: alice.cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { id: string; role: string; createdAt: string }[];
      nextCursor: string | null;
    };
    expect(body.data.map((w) => [w.id, w.role])).toEqual([
      [a1.id, 'owner'],
      [a2.id, 'junior'],
    ]);
    expect(body.nextCursor).toBeNull();
    expect(JSON.stringify(body)).not.toContain(b1.id);

    // Cross-tenant: Bob sees only his own, even though Alice's exist.
    const bobs = (await (await call(app, '/v1/workspaces', { cookie: bob.cookie })).json()) as {
      data: { id: string }[];
    };
    expect(bobs.data.map((w) => w.id)).toEqual([b1.id]);
  });

  it('returns an empty list for a user in no workspace', async () => {
    const loner = await signIn();
    const response = await call(makeApp(), '/v1/workspaces', { cookie: loner.cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [], nextCursor: null });
  });

  it('paginates with ?limit and an opaque cursor', async () => {
    const user = await signIn();
    const ids = [];
    for (let i = 0; i < 3; i += 1) ids.push((await createWorkspace(user.id)).id);
    const app = makeApp();

    const first = (await (
      await call(app, '/v1/workspaces?limit=2', { cookie: user.cookie })
    ).json()) as { data: { id: string }[]; nextCursor: string | null };
    expect(first.data.map((w) => w.id)).toEqual(ids.slice(0, 2));
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = (await (
      await call(app, `/v1/workspaces?limit=2&cursor=${first.nextCursor ?? ''}`, {
        cookie: user.cookie,
      })
    ).json()) as { data: { id: string }[]; nextCursor: string | null };
    expect(second.data.map((w) => w.id)).toEqual(ids.slice(2));
    expect(second.nextCursor).toBeNull();
  });

  it('rejects invalid query params with 422 and field-level errors[]', async () => {
    const user = await signIn();
    const app = makeApp();
    const response = await call(app, '/v1/workspaces?limit=0', { cookie: user.cookie });
    expect(response.status).toBe(422);
    const problem = await problemOf(response);
    expect(problem.code).toBe('VALIDATION');
    expect(problem.errors).toEqual([expect.objectContaining({ path: 'query.limit' })]);

    const badCursor = await call(app, '/v1/workspaces?cursor=garbage', { cookie: user.cookie });
    expect(badCursor.status).toBe(422);
    expect((await problemOf(badCursor)).errors).toEqual([
      { path: 'query.cursor', message: 'Invalid cursor' },
    ]);
  });

  it('checks authentication before validation', async () => {
    const response = await call(makeApp(), '/v1/workspaces?limit=0');
    expect(response.status).toBe(401);
  });
});

const EchoBody = z.object({ title: z.string().min(1), count: z.number().int().positive() });

function withEchoRoute(v1: AppRouter): void {
  v1.openapi(
    defineRoute({
      method: 'post',
      path: '/echo',
      request: { body: { content: { 'application/json': { schema: EchoBody } } } },
      responses: { 200: { description: 'Echo' } },
    }),
    (c) => c.json(c.req.valid('json'), 200),
  );
}

describe('request validation and body limits', () => {
  it('rejects invalid bodies with 422 and one entry per field', async () => {
    const user = await signIn();
    const app = makeApp({ routes: withEchoRoute });
    const response = await call(app, '/v1/echo', {
      method: 'POST',
      cookie: user.cookie,
      body: { title: '', count: -1 },
    });
    expect(response.status).toBe(422);
    const problem = await problemOf(response);
    expect(problem.code).toBe('VALIDATION');
    expect(problem.errors?.map((e) => e.path).sort()).toEqual(['body.count', 'body.title']);
  });

  it('rejects malformed JSON as a 422 VALIDATION problem', async () => {
    const user = await signIn();
    const app = makeApp({ routes: withEchoRoute });
    const response = await call(app, '/v1/echo', {
      method: 'POST',
      cookie: user.cookie,
      rawBody: '{"title":',
    });
    expect(response.status).toBe(422);
    expect((await problemOf(response)).code).toBe('VALIDATION');
  });

  it('rejects bodies over 1 MB with 413, and lets a route group raise its limit', async () => {
    const user = await signIn();
    const big = { title: 'x'.repeat(1024 * 1024 + 1), count: 1 };

    const app = makeApp({ routes: withEchoRoute });
    const tooLarge = await call(app, '/v1/echo', {
      method: 'POST',
      cookie: user.cookie,
      body: big,
    });
    expect(tooLarge.status).toBe(413);
    expect((await problemOf(tooLarge)).code).toBe('PAYLOAD_TOO_LARGE');

    const raised = makeApp({
      routes: withEchoRoute,
      bodyLimit: { groups: { '/v1/echo': 2 * 1024 * 1024 } },
    });
    const ok = await call(raised, '/v1/echo', { method: 'POST', cookie: user.cookie, body: big });
    expect(ok.status).toBe(200);
  });
});

describe('errors and headers', () => {
  it('answers unknown paths with a 404 NOT_FOUND problem', async () => {
    const response = await call(makeApp(), '/v1/nope');
    expect(response.status).toBe(404);
    expect((await problemOf(response)).code).toBe('NOT_FOUND');
  });

  it('propagates a well-formed x-request-id into the header and problem body', async () => {
    const response = await call(makeApp(), '/v1/me', {
      headers: { 'x-request-id': 'req-abc.123' },
    });
    expect(response.headers.get('x-request-id')).toBe('req-abc.123');
    expect((await problemOf(response)).requestId).toBe('req-abc.123');
  });

  it('sets secure headers everywhere and no-store on authenticated responses', async () => {
    const user = await signIn();
    const app = makeApp();
    for (const path of ['/healthz', '/v1/me']) {
      const response = await call(app, path, { cookie: user.cookie });
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('cross-origin-resource-policy')).toBe('same-site');
    }
    const me = await call(app, '/v1/me', { cookie: user.cookie });
    expect(me.status).toBe(200);
    expect(me.headers.get('cache-control')).toBe('no-store');
  });
});

describe('workspace middleware', () => {
  function withScopedRoute(v1: AppRouter): void {
    v1.openapi(
      defineRoute({
        method: 'get',
        path: '/scoped',
        middleware: [requireWorkspace(testAppDb())],
        responses: { 200: { description: 'Scoped' } },
      }),
      async (c) => {
        const { user } = principalOf(c);
        const settings = await c.var.withWorkspace(async (tx) => {
          const [row] = await tx.execute<{ ws: string; uid: string }>(
            sql`select current_setting('app.workspace_id', true) as ws, current_setting('app.user_id', true) as uid`,
          );
          return row;
        });
        return c.json({ workspaceId: c.var.workspaceId, settings, userId: user.id }, 200);
      },
    );
    v1.openapi(
      createRoute({
        method: 'get',
        path: '/workspaces/{workspaceId}/scoped',
        security: [{ sessionCookie: [] }],
        middleware: [requireWorkspace(testAppDb())],
        request: { params: z.object({ workspaceId: z.string() }) },
        responses: { 200: { description: 'Scoped by path' } },
      }),
      (c) => c.json({ workspaceId: c.var.workspaceId }, 200),
    );
  }

  it('verifies membership and pins the workspace GUC for withWorkspace', async () => {
    const alice = await signIn();
    const mallory = await signIn();
    const workspace = await createWorkspace(alice.id);
    const app = makeApp({ routes: withScopedRoute });

    const ok = await call(app, '/v1/scoped', {
      cookie: alice.cookie,
      headers: { 'x-workspace-id': workspace.id },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      workspaceId: workspace.id,
      settings: { ws: workspace.id, uid: alice.id },
      userId: alice.id,
    });

    const byPath = await call(app, `/v1/workspaces/${workspace.id}/scoped`, {
      cookie: alice.cookie,
    });
    expect(byPath.status).toBe(200);

    const outsider = await call(app, '/v1/scoped', {
      cookie: mallory.cookie,
      headers: { 'x-workspace-id': workspace.id },
    });
    expect(outsider.status).toBe(403);
    expect((await problemOf(outsider)).code).toBe('FORBIDDEN');

    await addMember(workspace.id, mallory.id, 'viewer');
    const joined = await call(app, '/v1/scoped', {
      cookie: mallory.cookie,
      headers: { 'x-workspace-id': workspace.id },
    });
    expect(joined.status).toBe(200);
  });

  it('rejects a missing or malformed workspace id with 422', async () => {
    const user = await signIn();
    const app = makeApp({ routes: withScopedRoute });
    const missing = await call(app, '/v1/scoped', { cookie: user.cookie });
    expect(missing.status).toBe(422);
    const malformed = await call(app, '/v1/scoped', {
      cookie: user.cookie,
      headers: { 'x-workspace-id': 'not-a-uuid' },
    });
    expect(malformed.status).toBe(422);
    expect((await problemOf(malformed)).errors?.[0]?.path).toBe('header.x-workspace-id');
  });
});
