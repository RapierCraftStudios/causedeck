// `Idempotency-Key` on POST: replay for the same request, 409 for a different one, 24 h expiry.
import { randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createIdempotencyStore, IDEMPOTENCY_TTL_MS } from '../lib/idempotency-store.ts';
import { defineRoute, type AppRouter } from '../lib/openapi.ts';

import { call, makeApp, problemOf, signIn } from './helpers.ts';

afterAll(closeTestDb);

function counterApp(now: () => Date = () => new Date()) {
  let calls = 0;
  const routes = (v1: AppRouter) => {
    v1.openapi(
      defineRoute({
        method: 'post',
        path: '/things',
        request: {
          body: { content: { 'application/json': { schema: z.object({ name: z.string() }) } } },
        },
        responses: { 201: { description: 'Created' } },
      }),
      (c) => {
        calls += 1;
        c.header('location', `/v1/things/${String(calls)}`);
        return c.json({ id: calls, name: c.req.valid('json').name }, 201);
      },
    );
    v1.post('/boom', () => {
      calls += 1;
      throw new Error('kaboom');
    });
  };
  const app = makeApp({ routes, now });
  return { app, calls: () => calls };
}

describe('Idempotency-Key', () => {
  it('replays the stored response for an identical request', async () => {
    const user = await signIn();
    const { app, calls } = counterApp();
    const key = randomUUID();
    const send = () =>
      call(app, '/v1/things', {
        method: 'POST',
        cookie: user.cookie,
        headers: { 'idempotency-key': key },
        body: { name: 'Vakalatnama' },
      });

    const first = await send();
    expect(first.status).toBe(201);
    expect(first.headers.get('idempotency-replayed')).toBeNull();
    const firstBody = await first.json();

    const second = await send();
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotency-replayed')).toBe('true');
    expect(second.headers.get('location')).toBe('/v1/things/1');
    expect(await second.json()).toEqual(firstBody);
    expect(calls()).toBe(1);
  });

  it('returns 409 CONFLICT for the same key with a different body', async () => {
    const user = await signIn();
    const { app, calls } = counterApp();
    const key = randomUUID();
    const post = (name: string) =>
      call(app, '/v1/things', {
        method: 'POST',
        cookie: user.cookie,
        headers: { 'idempotency-key': key },
        body: { name },
      });

    expect((await post('one')).status).toBe(201);
    const conflict = await post('two');
    expect(conflict.status).toBe(409);
    expect((await problemOf(conflict)).code).toBe('CONFLICT');
    expect(calls()).toBe(1);
  });

  it('scopes keys by user', async () => {
    const alice = await signIn();
    const bob = await signIn();
    const { app, calls } = counterApp();
    const key = randomUUID();
    for (const user of [alice, bob]) {
      const response = await call(app, '/v1/things', {
        method: 'POST',
        cookie: user.cookie,
        headers: { 'idempotency-key': key },
        body: { name: 'same' },
      });
      expect(response.headers.get('idempotency-replayed')).toBeNull();
    }
    expect(calls()).toBe(2);
  });

  it('expires keys after 24 h', async () => {
    const user = await signIn();
    let clock = new Date('2026-10-18T09:00:00Z');
    const { app, calls } = counterApp(() => clock);
    const key = randomUUID();
    const send = () =>
      call(app, '/v1/things', {
        method: 'POST',
        cookie: user.cookie,
        headers: { 'idempotency-key': key },
        body: { name: 'x' },
      });

    await send();
    const [row] = await testAppDb()
      .select({ expiresAt: schema.apiIdempotencyKey.expiresAt })
      .from(schema.apiIdempotencyKey)
      .where(
        and(eq(schema.apiIdempotencyKey.userId, user.id), eq(schema.apiIdempotencyKey.key, key)),
      );
    expect(row?.expiresAt.getTime() ?? 0).toBe(clock.getTime() + IDEMPOTENCY_TTL_MS);

    clock = new Date(clock.getTime() + IDEMPOTENCY_TTL_MS - 1000);
    expect((await send()).headers.get('idempotency-replayed')).toBe('true');
    expect(calls()).toBe(1);

    clock = new Date(clock.getTime() + 2000);
    const fresh = await send();
    expect(fresh.headers.get('idempotency-replayed')).toBeNull();
    expect(calls()).toBe(2);
  });

  it('does not store 5xx responses, so the client can retry', async () => {
    const user = await signIn();
    const { app, calls } = counterApp();
    const key = randomUUID();
    for (let i = 0; i < 2; i += 1) {
      const response = await call(app, '/v1/boom', {
        method: 'POST',
        cookie: user.cookie,
        headers: { 'idempotency-key': key },
        body: {},
      });
      expect(response.status).toBe(500);
    }
    expect(calls()).toBe(2);
  });

  it('answers 409 while the first request with the key is still in progress', async () => {
    const user = await signIn();
    const store = createIdempotencyStore(testAppDb());
    const key = randomUUID();
    await store.claim({
      userId: user.id,
      key,
      workspaceId: null,
      method: 'POST',
      path: '/v1/things',
      // Matching hash for body {"name":"x"} is irrelevant: in-progress wins after the hash check.
      requestHash: 'pending',
      now: new Date(),
    });
    const { app } = counterApp();
    const response = await call(app, '/v1/things', {
      method: 'POST',
      cookie: user.cookie,
      headers: { 'idempotency-key': key },
      body: { name: 'x' },
    });
    expect(response.status).toBe(409);
  });

  it('purges expired rows', async () => {
    const user = await signIn();
    const store = createIdempotencyStore(testAppDb());
    const key = randomUUID();
    const past = new Date('2020-01-01T00:00:00Z');
    await store.claim({
      userId: user.id,
      key,
      workspaceId: null,
      method: 'POST',
      path: '/v1/x',
      requestHash: 'h',
      now: past,
    });
    expect(
      await store.purgeExpired(new Date(past.getTime() + IDEMPOTENCY_TTL_MS + 1)),
    ).toBeGreaterThanOrEqual(1);
    expect(await store.get(user.id, key)).toBeNull();
  });
});
