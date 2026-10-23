// Flag-gated API routes (#22): a disabled flag answers exactly like a missing route (404
// NOT_FOUND, no flag name in the body), whether the gate is the route middleware or `requireFlag`
// inside a handler; once staff turn the flag on for the workspace the route serves.
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { asStaff, setWorkspaceFlag } from '@causedeck/flags';
import { requireFlag } from '@causedeck/flags/server';
import { afterAll, describe, expect, it } from 'vitest';

import { defineRoute, type AppRouter } from '../lib/openapi.ts';
import { requireFlagMiddleware } from '../middleware/flags.ts';
import { requireWorkspace, WORKSPACE_HEADER } from '../middleware/workspace.ts';

import { call, createWorkspace, makeApp, problemOf, signIn } from './helpers.ts';

afterAll(closeTestDb);

function withFlaggedRoutes(v1: AppRouter): void {
  // The test database, no kill switches and no process cache: each request reads committed rows.
  const deps = { db: testAppDb(), killSwitches: {}, cache: null };
  v1.openapi(
    defineRoute({
      method: 'get',
      path: '/flagged/insights',
      middleware: [requireWorkspace(testAppDb()), requireFlagMiddleware('insights.enabled', deps)],
      responses: { 200: { description: 'Flagged' } },
    }),
    (c) => c.json({ ok: true }, 200),
  );
  v1.openapi(
    defineRoute({
      method: 'get',
      path: '/flagged/invoices',
      middleware: [requireWorkspace(testAppDb())],
      responses: { 200: { description: 'Flagged in the handler' } },
    }),
    async (c) => {
      await requireFlag('invoices.enabled', { workspaceId: c.var.workspaceId }, deps);
      return c.json({ ok: true }, 200);
    },
  );
}

describe('requireFlag in routes', () => {
  it('returns 404 NOT_FOUND while off, indistinguishable from a missing route', async () => {
    const user = await signIn();
    const workspace = await createWorkspace(user.id);
    const app = makeApp({ routes: withFlaggedRoutes });
    const headers = { [WORKSPACE_HEADER]: workspace.id };

    const missing = await call(app, '/v1/no-such-route', { cookie: user.cookie, headers });
    const missingProblem = await problemOf(missing);
    for (const path of ['/v1/flagged/insights', '/v1/flagged/invoices']) {
      const response = await call(app, path, { cookie: user.cookie, headers });
      expect(response.status, path).toBe(404);
      const body = await response.text();
      expect(body).not.toMatch(/insights|invoices|FEATURE_OFF|flag/i);
      const problem = JSON.parse(body) as typeof missingProblem;
      expect(problem).toMatchObject({
        status: 404,
        code: 'NOT_FOUND',
        type: missingProblem.type,
        title: missingProblem.title,
        detail: missingProblem.detail,
      });
    }
  });

  it('serves the route once the flag is on for the workspace, and only for that workspace', async () => {
    const user = await signIn();
    const on = await createWorkspace(user.id);
    const off = await createWorkspace(user.id);
    await setWorkspaceFlag(testAppDb(), asStaff(user.id), {
      workspaceId: on.id,
      key: 'insights.enabled',
      enabled: true,
    });
    const app = makeApp({ routes: withFlaggedRoutes });

    const served = await call(app, '/v1/flagged/insights', {
      cookie: user.cookie,
      headers: { [WORKSPACE_HEADER]: on.id },
    });
    expect(served.status).toBe(200);
    expect(await served.json()).toEqual({ ok: true });

    const other = await call(app, '/v1/flagged/insights', {
      cookie: user.cookie,
      headers: { [WORKSPACE_HEADER]: off.id },
    });
    expect(other.status).toBe(404);
  });
});
