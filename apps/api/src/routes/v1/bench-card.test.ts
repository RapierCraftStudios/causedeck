// `GET /v1/workspaces/{id}/matters/{id}/bench-card` (#521, D-050): with the legal-gated `bench_facts`
// flag off (the default) the route is a plain 404 and returns no judge-level data.
import { randomUUID } from 'node:crypto';

import { closeTestDb } from '@causedeck/db/testing';
import { afterAll, describe, expect, it } from 'vitest';

import { call, createWorkspace, makeApp, signIn } from '../../__tests__/helpers.ts';

afterAll(closeTestDb);

describe('GET bench-card', () => {
  it('is 404 with no judge-level data while the flag is off', async () => {
    const user = await signIn();
    const workspace = await createWorkspace(user.id);
    const response = await call(
      makeApp(),
      `/v1/workspaces/${workspace.id}/matters/${randomUUID()}/bench-card`,
      { cookie: user.cookie },
    );
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toMatch(/judges?|sat|sittings|bench_facts|flag/i);
  });

  it('needs a signed-in caller', async () => {
    const response = await call(
      makeApp(),
      `/v1/workspaces/${randomUUID()}/matters/${randomUUID()}/bench-card`,
    );
    expect(response.status).toBe(401);
  });
});
