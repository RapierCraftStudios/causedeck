// Security event capture from the Better Auth hooks (#228): every flow below runs through a real
// `createAuth` with a recording `SecurityEventRecorder` in place of the core audit writer.
import { randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { RATE_LIMIT_MESSAGE } from '../rate-limit';
import {
  noopSecurityEventRecorder,
  securityEventHook,
  signInMethod,
  type SecurityEventInput,
  type SecurityEventRecorder,
} from '../server';
import {
  authRequest,
  capturingLogger,
  cookieHeader,
  devSignInAs,
  makeAuth,
  recordingMailer,
  totp,
  uniqueEmail,
  uniqueIp,
  type TestAuth,
} from './helpers';

afterAll(closeTestDb);

type Kind = keyof SecurityEventRecorder;

interface Recording extends SecurityEventRecorder {
  events: { kind: Kind; event: SecurityEventInput }[];
  of(kind: Kind): SecurityEventInput[];
}

function recorder(): Recording {
  const events: Recording['events'] = [];
  const push = (kind: Kind) => (event: SecurityEventInput) => {
    events.push({ kind, event });
    return Promise.resolve();
  };
  return {
    events,
    of: (kind) => events.filter((e) => e.kind === kind).map((e) => e.event),
    signInSucceeded: push('signInSucceeded'),
    signInFailed: push('signInFailed'),
    magicLinkRequested: push('magicLinkRequested'),
    passkeyAdded: push('passkeyAdded'),
    passkeyRemoved: push('passkeyRemoved'),
    twoFactorEnabled: push('twoFactorEnabled'),
    twoFactorDisabled: push('twoFactorDisabled'),
    sessionRevoked: push('sessionRevoked'),
  };
}

function setup() {
  const events = recorder();
  const mailer = recordingMailer();
  const { auth } = makeAuth({ securityEvents: events, mailer });
  return { auth, events, mailer };
}

async function requestLink(auth: TestAuth, email: string, ip = uniqueIp()) {
  return authRequest(auth, '/sign-in/magic-link', { ip, body: { email } });
}

describe('magic link', () => {
  it('records the request with the email (hashed by core) and client details', async () => {
    const { auth, events } = setup();
    const email = uniqueEmail('req');
    const ip = uniqueIp();
    expect((await requestLink(auth, email, ip)).status).toBe(200);
    expect(events.of('magicLinkRequested')).toEqual([expect.objectContaining({ email, ip })]);
  });

  it('records requests for known and unknown addresses alike (no enumeration)', async () => {
    const { auth, events } = setup();
    const { user } = await devSignInAs(auth);
    await requestLink(auth, user.email);
    await requestLink(auth, uniqueEmail('unknown'));
    expect(events.of('magicLinkRequested')).toHaveLength(2);
  });

  it('keeps the per-email rate limit and does not record a rate-limited request', async () => {
    const { auth, events } = setup();
    const email = uniqueEmail('limit');
    for (let i = 0; i < 5; i++) expect((await requestLink(auth, email)).status).toBe(200);
    const blocked = await requestLink(auth, email);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ message: RATE_LIMIT_MESSAGE });
    expect(events.of('magicLinkRequested')).toHaveLength(5);
  });

  it('records a successful verify as a magic_link sign-in, a bad token as a failure', async () => {
    const { auth, events, mailer } = setup();
    const email = uniqueEmail('verify');
    await requestLink(auth, email);
    await vi.waitFor(() => {
      expect(mailer.sent).toHaveLength(1);
    });
    const verify = await authRequest(auth, mailer.sent[0]?.url ?? '', { method: 'GET' });
    expect(verify.status).toBe(302);
    const [signIn] = events.of('signInSucceeded');
    expect(signIn).toMatchObject({ method: 'magic_link' });
    expect(signIn?.sessionId).toEqual(expect.any(String));
    expect(signIn?.userId).toEqual(expect.any(String));

    const bad = await authRequest(auth, `/magic-link/verify?token=${randomUUID()}`, {
      method: 'GET',
    });
    expect(bad.status).toBe(302);
    expect(bad.headers.get('location')).toMatch(/error=/);
    expect(events.of('signInFailed')).toEqual([
      expect.objectContaining({ method: 'magic_link', userId: null }),
    ]);
  });

  it('still answers a failed verify when the recorder fails', async () => {
    const events = recorder();
    events.signInFailed = () => Promise.reject(new Error('audit down'));
    const logger = capturingLogger();
    const { auth } = makeAuth({ securityEvents: events, logger });
    const bad = await authRequest(auth, `/magic-link/verify?token=${randomUUID()}`, {
      method: 'GET',
    });
    expect(bad.status).toBe(302);
    expect(logger.lines.some((l) => l.includes('failed sign-in not recorded'))).toBe(true);
  });
});

describe('sessions', () => {
  it('records the dev sign-in as a dev sign-in', async () => {
    const { auth, events } = setup();
    const { user } = await devSignInAs(auth);
    expect(events.of('signInSucceeded')).toEqual([
      expect.objectContaining({ userId: user.id, method: 'dev' }),
    ]);
  });

  it('records revoke-session and each session of revoke-other-sessions, but not sign-out', async () => {
    const { auth, events } = setup();
    const email = uniqueEmail('revoke');
    const first = await devSignInAs(auth, email);
    const second = await devSignInAs(auth, email);
    const third = await devSignInAs(auth, email);
    const sessions = await testAppDb()
      .select({ id: schema.session.id, token: schema.session.token })
      .from(schema.session)
      .where(eq(schema.session.userId, first.user.id));
    expect(sessions).toHaveLength(3);
    const token = third.cookie.match(/session_token=([^.;]+)/)?.[1];
    const target = sessions.find((s) => s.token !== token);
    if (!target) throw new Error('no session to revoke');

    const revoke = await authRequest(auth, '/revoke-session', {
      cookie: third.cookie,
      body: { token: target.token },
    });
    expect(revoke.status).toBe(200);
    expect(events.of('sessionRevoked')).toEqual([
      expect.objectContaining({ sessionId: target.id, userId: first.user.id }),
    ]);

    const others = await authRequest(auth, '/revoke-other-sessions', {
      cookie: third.cookie,
      body: {},
    });
    expect(others.status).toBe(200);
    expect(events.of('sessionRevoked')).toHaveLength(2);

    await authRequest(auth, '/sign-out', { cookie: third.cookie, body: {} });
    expect(events.of('sessionRevoked')).toHaveLength(2);
    expect(second.cookie).toBeTruthy();
  });
});

describe('two-factor', () => {
  it('records enable on the first verification and disable', async () => {
    const { auth, events } = setup();
    const { user, cookie } = await devSignInAs(auth);
    // `/two-factor/enable` re-checks a password, so give the passwordless user a credential.
    const ctx = await auth.$context;
    await testAppDb()
      .insert(schema.account)
      .values({
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: await ctx.password.hash('correct horse battery staple'),
      });
    const enable = await authRequest(auth, '/two-factor/enable', {
      cookie,
      body: { password: 'correct horse battery staple' },
    });
    expect(enable.status).toBe(200);
    const { totpURI } = (await enable.json()) as { totpURI: string };
    // Enabling needs a first verification; nothing is enabled yet.
    expect(events.of('twoFactorEnabled')).toHaveLength(0);

    const secret = new URL(totpURI).searchParams.get('secret') ?? '';
    const verify = await authRequest(auth, '/two-factor/verify-totp', {
      cookie,
      body: { code: totp(secret) },
    });
    expect(verify.status).toBe(200);
    expect(events.of('twoFactorEnabled')).toEqual([expect.objectContaining({ userId: user.id })]);

    const disable = await authRequest(auth, '/two-factor/disable', {
      cookie: cookieHeader(verify) || cookie,
      body: { password: 'correct horse battery staple' },
    });
    expect(disable.status).toBe(200);
    expect(events.of('twoFactorDisabled')).toEqual([expect.objectContaining({ userId: user.id })]);
  });
});

describe('passkeys', () => {
  it('records a passkey deletion with its id', async () => {
    const { auth, events } = setup();
    const { user, cookie } = await devSignInAs(auth);
    const [row] = await testAppDb()
      .insert(schema.passkey)
      .values({
        userId: user.id,
        publicKey: 'pk',
        credentialID: randomUUID(),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
      })
      .returning({ id: schema.passkey.id });
    if (!row) throw new Error('passkey insert failed');
    const response = await authRequest(auth, '/passkey/delete-passkey', {
      cookie,
      body: { id: row.id },
    });
    expect(response.status).toBe(200);
    expect(events.of('passkeyRemoved')).toEqual([
      expect.objectContaining({ userId: user.id, passkeyId: row.id }),
    ]);
  });

  it('records a passkey registration and a failed passkey sign-in (hook dispatch)', async () => {
    const events = recorder();
    const hook = securityEventHook(events, capturingLogger());
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' });
    await hook({
      path: '/passkey/verify-registration',
      headers,
      context: { returned: { id: 'pk-1' }, session: { user: { id: 'u-1' } } },
    });
    await hook({
      path: '/passkey/verify-authentication',
      headers,
      context: { returned: new APIError('UNAUTHORIZED'), session: null },
    });
    expect(events.of('passkeyAdded')).toEqual([
      { ip: '198.51.100.9', userId: 'u-1', passkeyId: 'pk-1' },
    ]);
    expect(events.of('signInFailed')).toEqual([
      { ip: '198.51.100.9', userId: null, method: 'passkey' },
    ]);
  });

  it('propagates a recorder failure on a success path (fail-closed)', async () => {
    const events = recorder();
    events.passkeyAdded = () => Promise.reject(new Error('audit down'));
    const hook = securityEventHook(events, capturingLogger());
    await expect(
      hook({
        path: '/passkey/verify-registration',
        context: { returned: { id: 'pk-1' }, session: { user: { id: 'u-1' } } },
      }),
    ).rejects.toThrow('audit down');
  });
});

describe('wiring', () => {
  it('derives the sign-in method from the request path', () => {
    expect(signInMethod('/magic-link/verify')).toBe('magic_link');
    expect(signInMethod('/passkey/verify-authentication')).toBe('passkey');
    expect(signInMethod('/callback/:id')).toBe('google');
    expect(signInMethod('/two-factor/verify-backup-code')).toBe('two_factor');
    expect(signInMethod('/dev/sign-in')).toBe('dev');
    expect(signInMethod(undefined)).toBe('unknown');
  });

  it('works without a recorder (the no-op default)', async () => {
    const { auth } = makeAuth();
    await expect(devSignInAs(auth)).resolves.toBeDefined();
    await expect(noopSecurityEventRecorder.signInSucceeded({})).resolves.toBeUndefined();
  });
});
