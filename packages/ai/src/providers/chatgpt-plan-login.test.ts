import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAuthorizeUrl,
  CHATGPT_PLAN_OPENID_CONFIGURATION,
  createPkce,
  exchangeCode,
  LoginError,
  newHostId,
  parseCallback,
  verifyIdToken,
  writeTokenFile,
} from './chatgpt-plan-login.ts';
import type { ChatgptPlanTokenFile } from './chatgpt-plan-token.ts';

const HOST = 'urn:uuid:11111111-1111-4111-8111-111111111111';

describe('authorize URL', () => {
  const common = {
    appName: 'CauseDeck preview',
    extAgentHostId: HOST,
    state: 'st',
    nonce: 'no',
    codeChallenge: 'ch',
  };

  it('carries every parameter on first registration', () => {
    const url = new URL(buildAuthorizeUrl(common));
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.openai.com/api/accounts/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'dynamic_agent_client',
      agent_name_hint: 'CauseDeck preview',
      ext_agent_host_id: HOST,
      redirect_uri: 'http://127.0.0.1:1455/auth/callback',
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      resource: 'https://api.openai.com/v1',
      state: 'st',
      nonce: 'no',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });

  it('re-login uses the saved oaiapp_ id and no name hint', () => {
    const url = new URL(buildAuthorizeUrl({ ...common, clientId: 'oaiapp_saved' }));
    expect(url.searchParams.get('client_id')).toBe('oaiapp_saved');
    expect(url.searchParams.has('agent_name_hint')).toBe(false);
    expect(url.searchParams.get('ext_agent_host_id')).toBe(HOST);
    expect(buildAuthorizeUrl({ ...common, clientId: 'oaiapp_saved' })).not.toBe(
      buildAuthorizeUrl(common),
    );
  });

  it('host ids are urn:uuid values', () => {
    expect(newHostId()).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(newHostId()).not.toBe(newHostId());
  });
});

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B vector', () => {
    expect(createPkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r-wW1gFWFOEjXk').challenge).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('generates base64url verifiers without padding', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('callback', () => {
  const cb = (q: string): string => `http://127.0.0.1:1455/auth/callback?${q}`;

  it('returns the code and the issued client id on first registration', () => {
    expect(parseCallback(cb('state=s&code=c&client_id=oaiapp_new'), { state: 's' })).toEqual({
      code: 'c',
      clientId: 'oaiapp_new',
    });
  });

  it('rejects a wrong state', () => {
    expect(() => parseCallback(cb('state=x&code=c&client_id=oaiapp_new'), { state: 's' })).toThrow(
      LoginError,
    );
  });

  it('rejects a missing or non-oaiapp_ client id on first registration', () => {
    expect(() => parseCallback(cb('state=s&code=c'), { state: 's' })).toThrow(/oaiapp_/);
    expect(() => parseCallback(cb('state=s&code=c&client_id=evil'), { state: 's' })).toThrow(
      /oaiapp_/,
    );
  });

  it('rejects a missing code and keeps the saved id on re-login', () => {
    expect(() => parseCallback(cb('state=s'), { state: 's' })).toThrow(/code/);
    expect(parseCallback(cb('state=s&code=c'), { state: 's', clientId: 'oaiapp_saved' })).toEqual({
      code: 'c',
      clientId: 'oaiapp_saved',
    });
  });
});

describe('code exchange', () => {
  it('posts the authorization_code form body', async () => {
    const f = vi.fn((_u: string | URL | Request, _i?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'a',
            refresh_token: 'r',
            id_token: 'i',
            scope: 'openid chatgpt.tokens.use.direct',
            expires_in: 3600,
          }),
        ),
      ),
    );
    const tokens = await exchangeCode({
      clientId: 'oaiapp_x',
      code: 'the-code',
      codeVerifier: 'the-verifier',
      fetch: f,
    });
    expect(tokens).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      idToken: 'i',
      scope: 'openid chatgpt.tokens.use.direct',
      expiresIn: 3600,
    });
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe('https://auth.openai.com/api/accounts/oauth/token');
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      grant_type: 'authorization_code',
      client_id: 'oaiapp_x',
      code: 'the-code',
      code_verifier: 'the-verifier',
      redirect_uri: 'http://127.0.0.1:1455/auth/callback',
      resource: 'https://api.openai.com/v1',
    });
  });

  it('a failed exchange carries only the status', async () => {
    const f = vi.fn(() => Promise.resolve(new Response('secret body', { status: 400 })));
    const error = (await exchangeCode({
      clientId: 'oaiapp_x',
      code: 'c',
      codeVerifier: 'v',
      fetch: f,
    }).catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('HTTP 400');
    expect(error.message).not.toContain('secret body');
  });
});

describe('id token verification', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const ISSUER = 'https://auth.openai.com';
  const NOW = Date.parse('2026-11-24T10:00:00Z');
  const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

  const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');
  function token(claims: Record<string, unknown>, key = privateKey): string {
    const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const body = b64({
      iss: ISSUER,
      aud: 'oaiapp_x',
      sub: 'user-123',
      exp: NOW / 1000 + 600,
      nonce: 'n1',
      ...claims,
    });
    const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
    return `${head}.${body}.${sig}`;
  }
  const f = vi.fn((url: string | URL | Request) => {
    const u = String(url);
    if (u === CHATGPT_PLAN_OPENID_CONFIGURATION) {
      return Promise.resolve(
        new Response(JSON.stringify({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks.json` })),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({ keys: [jwk] })));
  });
  const expected = {
    clientId: 'oaiapp_x',
    nonce: 'n1',
    scope: SCOPE,
    fetch: f,
    now: () => new Date(NOW),
  };

  it('accepts a token signed by the published key', async () => {
    await expect(verifyIdToken(token({}), expected)).resolves.toMatchObject({ sub: 'user-123' });
    expect(f).toHaveBeenCalledWith(CHATGPT_PLAN_OPENID_CONFIGURATION);
  });

  it.each([
    ['a bad nonce', { nonce: 'other' }, /nonce/],
    ['a bad audience', { aud: 'oaiapp_other' }, /audience/],
    ['an expired token', { exp: NOW / 1000 - 1 }, /expired/],
    ['a bad issuer', { iss: 'https://evil.example' }, /issuer/],
  ])('rejects %s', async (_name, claims, message) => {
    await expect(verifyIdToken(token(claims), expected)).rejects.toThrow(message);
  });

  it('rejects a token signed by another key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(verifyIdToken(token({}, other), expected)).rejects.toThrow(/signature/);
  });

  it('requires the plan usage scope', async () => {
    await expect(
      verifyIdToken(token({}), { ...expected, scope: 'openid offline_access' }),
    ).rejects.toThrow(/chatgpt\.tokens\.use\.direct/);
  });
});

describe('token file', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'chatgpt-plan-login-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const tokens = {
    accessToken: 'a',
    refreshToken: 'r',
    idToken: 'i',
    scope: 'openid chatgpt.tokens.use.direct',
    expiresIn: 3600,
  };

  it('writes a 0600 file with the client id and tokens', async () => {
    const file = path.join(dir, 'tokens.json');
    const now = (): Date => new Date('2026-11-24T10:00:00Z');
    await writeTokenFile(file, { clientId: 'oaiapp_x', extAgentHostId: HOST, tokens, now });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      version: 1,
      clientId: 'oaiapp_x',
      extAgentHostId: HOST,
      accessToken: 'a',
      refreshToken: 'r',
      idToken: 'i',
      scope: 'openid chatgpt.tokens.use.direct',
      expiresAt: '2026-11-24T11:00:00.000Z',
    });
  });

  it('keeps the existing host id on re-login', async () => {
    const file = path.join(dir, 'tokens.json');
    const existing: ChatgptPlanTokenFile = {
      version: 1,
      clientId: 'oaiapp_x',
      extAgentHostId: HOST,
      accessToken: 'old',
      refreshToken: 'old',
      idToken: 'old',
      scope: 's',
      expiresAt: '2026-01-01T00:00:00.000Z',
    };
    writeFileSync(file, JSON.stringify(existing), { mode: 0o600 });
    const written = await writeTokenFile(file, {
      clientId: 'oaiapp_x',
      extAgentHostId: newHostId(),
      tokens,
    });
    expect(written.extAgentHostId).toBe(HOST);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
