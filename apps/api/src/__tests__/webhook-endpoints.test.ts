// `/v1/webhook-endpoints` through the real app (#626): a key needs `webhooks:write` on every method,
// stays inside its own workspace, and sees the signing secret once.
import { createApiKey } from '@causedeck/core/api-keys';
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { afterAll, describe, expect, it } from 'vitest';

import { call, createWorkspace, makeApp, problemOf, signIn } from './helpers.ts';

afterAll(closeTestDb);

async function issue(scopes: string[]) {
  const user = await signIn();
  const workspace = await createWorkspace(user.id, 'owner');
  const { token } = await createApiKey(testAppDb(), {
    workspaceId: workspace.id,
    actorUserId: user.id,
    name: 'webhooks',
    scopes,
  });
  return { user, workspace, token };
}

const URL_A = 'https://hooks.example.com/a';

describe('/v1/webhook-endpoints', () => {
  it('answers 403 to a key without webhooks:write on every method', async () => {
    const { token } = await issue(['cases:read']);
    const app = makeApp();
    const id = '00000000-0000-4000-8000-000000000001';
    const responses = [
      await call(app, '/v1/webhook-endpoints', {
        method: 'POST',
        bearer: token,
        body: { url: URL_A },
      }),
      await call(app, '/v1/webhook-endpoints', { bearer: token }),
      await call(app, `/v1/webhook-endpoints/${id}`, { method: 'DELETE', bearer: token }),
    ];
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403]);
    expect((await problemOf(responses[0] as Response)).code).toBe('FORBIDDEN');
  });

  it('creates, lists and deletes with the scope; the secret is shown once', async () => {
    const { token } = await issue(['webhooks:write']);
    const app = makeApp();
    const created = await call(app, '/v1/webhook-endpoints', {
      method: 'POST',
      bearer: token,
      body: { url: URL_A, events: ['status.changed'] },
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; secret: string; events: string[] };
    expect(body.secret).toMatch(/^whsec_/);
    expect(body.events).toEqual(['status.changed']);

    const list = await call(app, '/v1/webhook-endpoints', { bearer: token });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { data: Record<string, unknown>[] };
    expect(listed.data.map((e) => e.id)).toEqual([body.id]);
    expect(JSON.stringify(listed)).not.toContain('secret');

    const removed = await call(app, `/v1/webhook-endpoints/${body.id}`, {
      method: 'DELETE',
      bearer: token,
    });
    expect(removed.status).toBe(204);
    const after = (await (await call(app, '/v1/webhook-endpoints', { bearer: token })).json()) as {
      data: unknown[];
    };
    expect(after.data).toEqual([]);
  });

  it('rejects a non-https url with 422', async () => {
    const { token } = await issue(['webhooks:write']);
    const response = await call(makeApp(), '/v1/webhook-endpoints', {
      method: 'POST',
      bearer: token,
      body: { url: 'http://hooks.example.com/a' },
    });
    expect(response.status).toBe(422);
  });

  it("a key cannot see or delete another workspace's endpoint", async () => {
    const a = await issue(['webhooks:write']);
    const b = await issue(['webhooks:write']);
    const app = makeApp();
    const created = await call(app, '/v1/webhook-endpoints', {
      method: 'POST',
      bearer: a.token,
      body: { url: URL_A },
    });
    const { id } = (await created.json()) as { id: string };

    const seenByB = (await (
      await call(app, '/v1/webhook-endpoints', { bearer: b.token })
    ).json()) as {
      data: unknown[];
    };
    expect(seenByB.data).toEqual([]);
    const deleted = await call(app, `/v1/webhook-endpoints/${id}`, {
      method: 'DELETE',
      bearer: b.token,
    });
    expect(deleted.status).toBe(404);
    const stillThere = (await (
      await call(app, '/v1/webhook-endpoints', { bearer: a.token })
    ).json()) as {
      data: unknown[];
    };
    expect(stillThere.data).toHaveLength(1);
  });
});
