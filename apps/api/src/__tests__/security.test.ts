// Every `/v1` route declares `security` or is explicitly `public: true`. The guard fails for a
// route registered without either, so a forgotten auth requirement cannot ship.
import { closeTestDb } from '@causedeck/db/testing';
import { createRoute, z } from '@hono/zod-openapi';
import { afterAll, describe, expect, it } from 'vitest';

import { AUTHENTICATED, assertRouteSecurity, defineRoute, type AppRouter } from '../lib/openapi.ts';

import { call, makeApp } from './helpers.ts';

afterAll(closeTestDb);

const ok = { 200: { description: 'OK' } };

describe('route security guard', () => {
  it('finds no unannotated route in the real app', () => {
    expect(assertRouteSecurity(makeApp())).toEqual([]);
  });

  it('fails for a /v1 route registered without security or public: true', () => {
    const routes = (v1: AppRouter) => {
      v1.openapi(createRoute({ method: 'get', path: '/leaky', responses: ok }), (c) =>
        c.json({}, 200),
      );
    };
    expect(assertRouteSecurity(makeApp({ routes }))).toEqual([
      { method: 'get', path: '/v1/leaky' },
    ]);
  });

  it('fails for a plain Hono handler that bypasses the OpenAPI registry', () => {
    const routes = (v1: AppRouter) => {
      v1.post('/raw', (c) => c.json({}, 200));
    };
    expect(assertRouteSecurity(makeApp({ routes }))).toEqual([{ method: 'post', path: '/v1/raw' }]);
  });

  it('accepts explicit public routes (webhooks verify signatures instead)', async () => {
    const routes = (v1: AppRouter) => {
      v1.openapi(
        defineRoute({ method: 'post', path: '/webhooks/test', public: true, responses: ok }),
        (c) => c.json({ received: true }, 200),
      );
    };
    const app = makeApp({ routes });
    expect(assertRouteSecurity(app)).toEqual([]);
    // Public routes skip requireAuth.
    const response = await call(app, '/v1/webhooks/test', { method: 'POST', body: {} });
    expect(response.status).toBe(200);
  });

  it('gives defineRoute routes OpenAPI security and enforces it at runtime', async () => {
    const routes = (v1: AppRouter) => {
      v1.openapi(
        defineRoute({
          method: 'get',
          path: '/guarded',
          request: { query: z.object({ n: z.coerce.number() }) },
          responses: ok,
        }),
        (c) => c.json({}, 200),
      );
    };
    const app = makeApp({ routes });
    const document = (await (await call(app, '/openapi.json')).json()) as {
      paths: Record<string, Record<string, { security?: unknown }>>;
    };
    expect(document.paths['/v1/guarded']?.get?.security).toEqual(AUTHENTICATED);
    expect((await call(app, '/v1/guarded?n=1')).status).toBe(401);
  });

  it('declares security on every operation in the served document', async () => {
    const document = (await (await call(makeApp(), '/openapi.json')).json()) as {
      paths: Record<string, Record<string, { security?: unknown[]; 'x-public'?: boolean }>>;
    };
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const declared = (operation.security?.length ?? 0) > 0 || operation['x-public'] === true;
        expect(declared, `${method.toUpperCase()} ${path}`).toBe(true);
      }
    }
  });
});
