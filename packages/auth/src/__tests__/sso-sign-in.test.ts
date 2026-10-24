// SSO sign-in (#683) against the real `createAuth` and a mocked OIDC identity provider: the
// provider is a row of `sso_provider` (read through the `sso_provider_auth` view); the IdP's token
// and JWKS endpoints are answered by a stubbed `fetch`. Better Auth commits its own writes, so
// tests isolate by unique domains, emails and client IPs.
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';

import { schema, withWorkspace } from '@causedeck/db';
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { RATE_LIMIT_MESSAGE, SSO_DOMAIN_LIMIT } from '../rate-limit';
import type { SecurityEventRecorder } from '../server';
import { authRequest, makeAuth, sessionSetCookie, uniqueEmail, uniqueIp } from './helpers';

const IDP = 'https://idp.sso-test.example';
const CLIENT_ID = 'causedeck-client';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

const b64 = (value: object | Buffer) =>
  Buffer.from(value instanceof Buffer ? value : JSON.stringify(value)).toString('base64url');

function idToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ iss: IDP, aud: CLIENT_ID, iat: now, exp: now + 300, ...claims });
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey);
  return `${head}.${body}.${b64(signature)}`;
}

/** The mocked IdP: `/token` returns an ID token for `profile`; `/jwks` its public key. */
function stubIdp(profile: { sub: string; email: string }) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== IDP) return realFetch(input, init);
    if (url.pathname === '/jwks') return Response.json({ keys: [jwk] });
    if (url.pathname === '/token') {
      return Response.json({
        access_token: 'at',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: idToken({ ...profile, name: 'Test User', email_verified: true }),
      });
    }
    return new Response('not found', { status: 404 });
  });
}

async function seedProvider(options: { enabled?: boolean } = {}) {
  const workspaceId = randomUUID();
  const ownerId = randomUUID();
  const providerId = randomUUID();
  const domain = `sso-${providerId.slice(0, 8)}.example.com`;
  const db = testAppDb();
  await db.insert(schema.user).values({
    id: ownerId,
    name: 'Owner',
    email: uniqueEmail('owner'),
    emailVerified: true,
  });
  await withWorkspace(db, { workspaceId, userId: ownerId }, async (tx) => {
    await tx
      .insert(schema.organization)
      .values({ id: workspaceId, name: 'SSO Chambers', slug: `sso-${providerId}`, createdBy: ownerId });
    await tx.insert(schema.member).values({ organizationId: workspaceId, userId: ownerId, role: 'owner' });
    await tx.insert(schema.ssoProvider).values({
      id: providerId,
      workspaceId,
      protocol: 'oidc',
      issuer: IDP,
      domain,
      enabled: options.enabled ?? true,
      createdBy: ownerId,
      config: {
        issuer: IDP,
        pkce: true,
        clientId: CLIENT_ID,
        clientSecret: 'client-secret',
        authorizationEndpoint: `${IDP}/authorize`,
        tokenEndpoint: `${IDP}/token`,
        jwksEndpoint: `${IDP}/jwks`,
        scopes: ['openid', 'email', 'profile'],
      },
    });
  });
  return { workspaceId, providerId, domain, ownerId };
}

function recorder() {
  const events: { kind: string; method?: string }[] = [];
  const securityEvents = {
    signInSucceeded: (e: { method?: string }) => {
      events.push({ kind: 'succeeded', ...(e.method ? { method: e.method } : {}) });
      return Promise.resolve();
    },
    signInFailed: (e: { method?: string }) => {
      events.push({ kind: 'failed', ...(e.method ? { method: e.method } : {}) });
      return Promise.resolve();
    },
  } as unknown as SecurityEventRecorder;
  const fallback = new Proxy(securityEvents, {
    get: (target, key) =>
      key in target ? (target as never)[key] : () => Promise.resolve(),
  });
  return { events, securityEvents: fallback };
}

afterAll(closeTestDb);
afterEach(() => {
  vi.unstubAllGlobals();
});

async function startSignIn(auth: ReturnType<typeof makeAuth>['auth'], email: string, ip = uniqueIp()) {
  return authRequest(auth, '/sign-in/sso', { ip, body: { email, callbackURL: '/' } });
}

describe('SSO sign-in', () => {
  it('signs a user at a configured domain in and makes them a viewer of the organisation', async () => {
    const seed = await seedProvider();
    const { events, securityEvents } = recorder();
    const { auth } = makeAuth({ securityEvents });
    const email = `ada@${seed.domain}`;
    stubIdp({ sub: `idp-${randomUUID()}`, email });

    const start = await startSignIn(auth, email);
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    expect(url.startsWith(`${IDP}/authorize`)).toBe(true);
    const state = new URL(url).searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await authRequest(
      auth,
      `/sso/callback/${seed.providerId}?code=abc&state=${state ?? ''}`,
      { method: 'GET' },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).not.toContain('error');
    expect(sessionSetCookie(callback)).toBeDefined();

    const [signedIn] = await testAppDb()
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email));
    expect(signedIn).toBeDefined();
    const members = await withWorkspace(
      testAppDb(),
      { workspaceId: seed.workspaceId, userId: signedIn?.id ?? '' },
      (tx) =>
        tx
          .select({ role: schema.member.role })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, seed.workspaceId),
              eq(schema.member.userId, signedIn?.id ?? ''),
            ),
          ),
    );
    expect(members).toEqual([{ role: 'viewer' }]);
    expect(events).toContainEqual({ kind: 'succeeded', method: 'sso' });
  });

  it('fails the same way for an unknown domain and a disabled provider', async () => {
    const disabled = await seedProvider({ enabled: false });
    const { auth } = makeAuth();
    const unknown = await startSignIn(auth, `a@unknown-${randomUUID().slice(0, 8)}.example.com`);
    const off = await startSignIn(auth, `a@${disabled.domain}`);
    expect(unknown.status).toBeGreaterThanOrEqual(400);
    expect(off.status).toBe(unknown.status);
    expect(await off.json()).toEqual(await unknown.json());
  });

  it('refuses a provider or organisation id, which would let a caller probe organisations', async () => {
    const seed = await seedProvider();
    const { auth } = makeAuth();
    const byProvider = await authRequest(auth, '/sign-in/sso', {
      body: { providerId: seed.providerId, callbackURL: '/' },
    });
    expect(byProvider.status).toBe(400);
  });

  it('does not expose the plugin provider endpoints', async () => {
    const { auth } = makeAuth();
    for (const path of ['/sso/register', '/sso/providers', '/sso/delete-provider']) {
      const response = await authRequest(auth, path, { method: 'POST', body: {} });
      expect(response.status, path).toBe(404);
    }
  });

  it('returns 429 after 10 starts for one domain in the window', async () => {
    const seed = await seedProvider();
    const { auth } = makeAuth();
    for (let i = 0; i < SSO_DOMAIN_LIMIT.max; i += 1) {
      const response = await startSignIn(auth, `u${String(i)}@${seed.domain}`);
      expect(response.status).toBe(200);
    }
    const limited = await startSignIn(auth, `late@${seed.domain}`);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { message: string }).message).toBe(RATE_LIMIT_MESSAGE);
  });

  it('records a failed SSO callback as a failed sso sign-in', async () => {
    const seed = await seedProvider();
    const { events, securityEvents } = recorder();
    const { auth } = makeAuth({ securityEvents });
    await authRequest(auth, `/sso/callback/${seed.providerId}?error=access_denied`, {
      method: 'GET',
    });
    await vi.waitFor(() => {
      expect(events).toContainEqual({ kind: 'failed', method: 'sso' });
    });
  });
});
