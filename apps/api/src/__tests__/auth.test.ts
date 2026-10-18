// `GET /v1/me` and the auth seam: 401 problem without a caller, 200 for a session cookie or a
// bearer token the injected resolver accepts.
import { closeTestDb } from '@causedeck/db/testing';
import { afterAll, describe, expect, it } from 'vitest';

import type { BearerResolver } from '../middleware/auth.ts';

import { call, createWorkspace, makeApp, problemOf, signIn } from './helpers.ts';

afterAll(closeTestDb);

describe('GET /v1/me', () => {
  it('returns a 401 UNAUTHENTICATED problem without a session', async () => {
    const response = await call(makeApp(), '/v1/me');
    expect(response.status).toBe(401);
    const problem = await problemOf(response);
    expect(problem).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(problem.requestId).toBe(response.headers.get('x-request-id'));
  });

  it('returns 401 for a forged session cookie', async () => {
    const response = await call(makeApp(), '/v1/me', {
      cookie: 'better-auth.session_token=forged.token',
    });
    expect(response.status).toBe(401);
    expect((await problemOf(response)).code).toBe('UNAUTHENTICATED');
  });

  it('returns {user, memberships[]} for a valid session cookie', async () => {
    const user = await signIn();
    const workspace = await createWorkspace(user.id, 'advocate');
    const response = await call(makeApp(), '/v1/me', { cookie: user.cookie });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      user: { id: user.id, email: user.email, name: null, image: null, locale: 'en' },
      memberships: [
        { workspaceId: workspace.id, name: workspace.name, slug: workspace.slug, role: 'advocate' },
      ],
    });
  });

  it('returns the caller for an API bearer token the resolver accepts', async () => {
    const user = await signIn();
    const bearer: BearerResolver = (token) =>
      Promise.resolve(
        token === 'pat_valid'
          ? {
              via: 'bearer',
              user: { id: user.id, email: user.email, name: null, image: null, locale: 'en' },
            }
          : null,
      );
    const app = makeApp({ bearer });

    const ok = await call(app, '/v1/me', { bearer: 'pat_valid' });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { user: { id: string } }).user.id).toBe(user.id);

    const bad = await call(app, '/v1/me', { bearer: 'pat_revoked' });
    expect(bad.status).toBe(401);
    expect((await problemOf(bad)).code).toBe('UNAUTHENTICATED');
  });

  it('rejects bearer tokens when no resolver is configured, and malformed Authorization', async () => {
    const user = await signIn();
    const app = makeApp();
    expect((await call(app, '/v1/me', { bearer: 'anything' })).status).toBe(401);
    // An Authorization header takes precedence over the cookie, so a bad one never falls back.
    const malformed = await call(app, '/v1/me', {
      cookie: user.cookie,
      headers: { authorization: 'Basic abc' },
    });
    expect(malformed.status).toBe(401);
  });
});
