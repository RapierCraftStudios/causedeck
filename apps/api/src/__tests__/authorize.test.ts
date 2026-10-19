// Route-level authorization (#234): `authorize(action)` after `requireWorkspace` asks the central
// policy; a denial is a 403 `FORBIDDEN` problem, and a read of a resource the caller may not see
// is a 404 `NOT_FOUND`, so its existence does not leak. Neither names the action or the reason.
import { ForbiddenError as PolicyForbiddenError } from '@causedeck/auth/policy';
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { defineRoute, type AppRouter } from '../lib/openapi.ts';
import { authorize } from '../middleware/authorize.ts';
import { toApiError } from '../middleware/error-handler.ts';
import { requireWorkspace } from '../middleware/workspace.ts';

import { addMember, call, createWorkspace, makeApp, problemOf, signIn } from './helpers.ts';

afterAll(closeTestDb);

const quiet = { warn: vi.fn() };

function withAuthorizedRoutes(v1: AppRouter): void {
  v1.openapi(
    defineRoute({
      method: 'get',
      path: '/authz/roles',
      middleware: [requireWorkspace(testAppDb()), authorize('member.role', { logger: quiet })],
      responses: { 200: { description: 'Owners only' } },
    }),
    (c) => c.json({ role: c.var.role }, 200),
  );
  v1.openapi(
    defineRoute({
      method: 'get',
      path: '/authz/matter',
      middleware: [
        requireWorkspace(testAppDb()),
        authorize('matter.read', {
          logger: quiet,
          resource: (c) => ({
            kind: 'matter',
            workspaceId: c.var.workspaceId,
            matterId: 'matter-1',
            restricted: { allowUserIds: [] },
          }),
        }),
      ],
      responses: { 200: { description: 'A restricted matter' } },
    }),
    (c) => c.json({ ok: true }, 200),
  );
}

describe('authorize middleware', () => {
  it('allows the owner, 403 FORBIDDEN for an advocate, 403 for non-members', async () => {
    const owner = await signIn();
    const advocate = await signIn();
    const outsider = await signIn();
    const workspace = await createWorkspace(owner.id);
    await addMember(workspace.id, advocate.id, 'advocate');
    const app = makeApp({ routes: withAuthorizedRoutes });
    const headers = { 'x-workspace-id': workspace.id };

    const ok = await call(app, '/v1/authz/roles', { cookie: owner.cookie, headers });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ role: 'owner' });

    const denied = await call(app, '/v1/authz/roles', { cookie: advocate.cookie, headers });
    expect(denied.status).toBe(403);
    const problem = await problemOf(denied);
    expect(problem).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(JSON.stringify(problem)).not.toMatch(/member\.role|ROLE_DENIED/);
    expect(quiet.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'authz.denied',
        action: 'member.role',
        reason: 'ROLE_DENIED',
      }),
      'authorization denied',
    );

    const stranger = await call(app, '/v1/authz/roles', { cookie: outsider.cookie, headers });
    expect(stranger.status).toBe(403);
  });

  it('answers a denied read of a restricted resource with 404 NOT_FOUND', async () => {
    const advocate = await signIn();
    const workspace = await createWorkspace(advocate.id, 'advocate');
    const app = makeApp({ routes: withAuthorizedRoutes });
    const response = await call(app, '/v1/authz/matter', {
      cookie: advocate.cookie,
      headers: { 'x-workspace-id': workspace.id },
    });
    expect(response.status).toBe(404);
    expect(await problemOf(response)).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('owners see restricted matters by default', async () => {
    const owner = await signIn();
    const workspace = await createWorkspace(owner.id);
    const app = makeApp({ routes: withAuthorizedRoutes });
    const response = await call(app, '/v1/authz/matter', {
      cookie: owner.cookie,
      headers: { 'x-workspace-id': workspace.id },
    });
    expect(response.status).toBe(200);
  });
});

describe('toApiError and policy denials', () => {
  it('maps the policy ForbiddenError to 403 FORBIDDEN, concealed reads to 404', () => {
    expect(toApiError(new PolicyForbiddenError('member.role', 'ROLE_DENIED'))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(toApiError(new PolicyForbiddenError('matter.read', 'CROSS_WORKSPACE'))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(toApiError(new PolicyForbiddenError('matter.write', 'RESTRICTED_MATTER'))).toMatchObject(
      {
        status: 403,
        code: 'FORBIDDEN',
      },
    );
  });
});
