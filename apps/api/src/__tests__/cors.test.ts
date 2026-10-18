// CORS allows only APP_URL (never `*`), with credentials; cookie-authenticated unsafe requests
// need a matching Origin (CSRF).
import { closeTestDb } from '@causedeck/db/testing';
import { afterAll, describe, expect, it } from 'vitest';

import type { AppRouter } from '../lib/openapi.ts';

import { APP_URL, call, makeApp, problemOf, signIn } from './helpers.ts';

afterAll(closeTestDb);

function withPost(v1: AppRouter): void {
  v1.post('/ping', (c) => c.json({ ok: true }, 200));
}

describe('CORS', () => {
  it('answers preflights only for the configured origin, with credentials', async () => {
    const app = makeApp();
    const preflight = await app.request('http://localhost:3001/v1/me', {
      method: 'OPTIONS',
      headers: {
        origin: APP_URL,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,idempotency-key',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(APP_URL);
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('idempotency-key');

    const evil = await app.request('http://localhost:3001/v1/me', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('never sends a wildcard, and reflects only allowed origins on simple requests', async () => {
    const app = makeApp();
    const allowed = await call(app, '/healthz', { origin: APP_URL });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(APP_URL);
    expect(allowed.headers.get('vary')).toContain('Origin');
    const other = await call(app, '/healthz', { origin: 'https://evil.example' });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    for (const response of [allowed, other]) {
      expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
    }
  });

  it('accepts several configured origins, normalised to bare origins', async () => {
    const app = makeApp({ allowedOrigins: [`${APP_URL}/`, 'https://app.causedeck.in/some/path'] });
    const response = await call(app, '/healthz', { origin: 'https://app.causedeck.in' });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.causedeck.in');
  });
});

describe('CSRF', () => {
  it('rejects cookie-authenticated POSTs without a matching Origin', async () => {
    const user = await signIn();
    const app = makeApp({ routes: withPost });
    const missing = await call(app, '/v1/ping', {
      method: 'POST',
      cookie: user.cookie,
      origin: null,
      body: {},
    });
    expect(missing.status).toBe(403);
    expect((await problemOf(missing)).code).toBe('FORBIDDEN');

    const foreign = await call(app, '/v1/ping', {
      method: 'POST',
      cookie: user.cookie,
      origin: 'https://evil.example',
      body: {},
    });
    expect(foreign.status).toBe(403);

    const same = await call(app, '/v1/ping', {
      method: 'POST',
      cookie: user.cookie,
      origin: APP_URL,
      body: {},
    });
    expect(same.status).toBe(200);
  });

  it('does not apply to safe methods or bearer-token callers', async () => {
    const user = await signIn();
    const app = makeApp({
      routes: withPost,
      bearer: (token) =>
        Promise.resolve(
          token === 'pat'
            ? {
                via: 'bearer',
                user: { id: user.id, email: user.email, name: null, image: null, locale: 'en' },
              }
            : null,
        ),
    });
    expect((await call(app, '/v1/me', { cookie: user.cookie, origin: null })).status).toBe(200);
    const bearer = await call(app, '/v1/ping', {
      method: 'POST',
      bearer: 'pat',
      origin: null,
      body: {},
    });
    expect(bearer.status).toBe(200);
  });
});
