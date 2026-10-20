import { Secret } from '@causedeck/config/env';
import { schema } from '@causedeck/db';
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { AUTH_EMAIL_KEYS } from '../messages';
import { magicLinkEmailKey, RATE_LIMIT_MESSAGE } from '../rate-limit';
import {
  createAuth,
  MAGIC_LINK_EXPIRES_IN_SECONDS,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  sessionUpdateAgeFor,
} from '../server';
import {
  authRequest,
  capturingLogger,
  cookieHeader,
  devSignInAs,
  makeAuth,
  recordingMailer,
  sessionSetCookie,
  TEST_SECRET,
  testEnv,
  totp,
  uniqueEmail,
  uniqueIp,
  type TestAuth,
} from './helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

afterAll(closeTestDb);
afterEach(() => {
  vi.restoreAllMocks();
});

async function requestLink(auth: TestAuth, email: string, ip = uniqueIp()) {
  return authRequest(auth, '/sign-in/magic-link', { ip, body: { email } });
}

function tokenOf(url: string): string {
  const token = new URL(url).searchParams.get('token');
  if (!token) throw new Error('magic link has no token');
  return token;
}

async function findUser(email: string) {
  const [row] = await testAppDb().select().from(schema.user).where(eq(schema.user.email, email));
  return row;
}

describe('magic link', () => {
  it('creates the user on first use and signs them in via the console mailer flow', async () => {
    const { auth, mailer } = makeAuth();
    const email = uniqueEmail('first');
    const response = await requestLink(auth, email);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(await findUser(email)).toBeUndefined();

    await vi.waitFor(() => {
      expect(mailer.sent).toHaveLength(1);
    });
    const [message] = mailer.sent;
    expect(message?.to).toBe(email);
    expect(message?.expiresInMinutes).toBe(10);

    const verify = await authRequest(auth, message?.url ?? '', { method: 'GET' });
    expect(verify.status).toBe(302);
    expect(sessionSetCookie(verify)).toBeDefined();
    const user = await findUser(email);
    expect(user?.emailVerified).toBe(true);
    expect(user?.locale).toBe('en');
  });

  it('stores the token hashed and expires it after 10 minutes', async () => {
    const { auth, mailer } = makeAuth();
    const before = Date.now();
    const email = uniqueEmail('hashed');
    await requestLink(auth, email);
    await vi.waitFor(() => {
      expect(mailer.sent).toHaveLength(1);
    });
    const token = tokenOf(mailer.sent[0]?.url ?? '');

    const rows = await testAppDb()
      .select()
      .from(schema.verification)
      .where(sql`${schema.verification.value} like ${`%${email}%`}`);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toBeDefined();
    expect(row?.identifier).not.toContain(token);
    expect(row?.value).not.toContain(token);
    const ttl = (row?.expiresAt.getTime() ?? 0) - before;
    expect(ttl).toBeGreaterThan((MAGIC_LINK_EXPIRES_IN_SECONDS - 5) * 1000);
    expect(ttl).toBeLessThanOrEqual((MAGIC_LINK_EXPIRES_IN_SECONDS + 5) * 1000);

    // Eleven minutes later the link no longer signs anyone in.
    await testAppDb()
      .update(schema.verification)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.verification.id, row?.id ?? ''));
    const verify = await authRequest(auth, mailer.sent[0]?.url ?? '', { method: 'GET' });
    expect(sessionSetCookie(verify)).toBeUndefined();
    expect(verify.headers.get('location')).toContain('error=');
  });

  it('is single-use', async () => {
    const { auth, mailer } = makeAuth();
    await requestLink(auth, uniqueEmail('once'));
    await vi.waitFor(() => {
      expect(mailer.sent).toHaveLength(1);
    });
    const url = mailer.sent[0]?.url ?? '';

    const first = await authRequest(auth, url, { method: 'GET' });
    expect(sessionSetCookie(first)).toBeDefined();
    const second = await authRequest(auth, url, { method: 'GET' });
    expect(sessionSetCookie(second)).toBeUndefined();
    expect(second.headers.get('location')).toContain('error=INVALID_TOKEN');
  });
});

describe('session cookies', () => {
  it('are httpOnly, SameSite=Lax, 30 days, and not Secure outside production', async () => {
    const { auth } = makeAuth();
    const { response } = await devSignInAs(auth);
    const cookie = sessionSetCookie(response) ?? '';
    expect(cookie).toMatch(/^better-auth\.session_token=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toContain(`Max-Age=${String(SESSION_EXPIRES_IN_SECONDS)}`);
    expect(cookie).not.toMatch(/;\s*Secure/i);
  });

  it('take a shorter lifetime when `sessionExpiresInSeconds` is set (admin console, #309)', async () => {
    const auth = createAuth({
      db: testAppDb(),
      env: testEnv(),
      mailer: recordingMailer(),
      logger: capturingLogger(),
      sessionExpiresInSeconds: 8 * 60 * 60,
    });
    const { response } = await devSignInAs(auth);
    expect(sessionSetCookie(response) ?? '').toContain('Max-Age=28800');
  });

  it('are Secure with the __Secure- prefix in production', async () => {
    const { auth, mailer } = makeAuth({ env: { NODE_ENV: 'production' } });
    await requestLink(auth, uniqueEmail('prod'));
    await vi.waitFor(() => {
      expect(mailer.sent).toHaveLength(1);
    });
    const verify = await authRequest(auth, mailer.sent[0]?.url ?? '', { method: 'GET' });
    const cookie = sessionSetCookie(verify) ?? '';
    expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('slide: a session older than a day is extended to 30 days on use', async () => {
    const { auth } = makeAuth();
    const { user, cookie } = await devSignInAs(auth);
    const [created] = await testAppDb()
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, user.id));
    const lifetime = (created?.expiresAt.getTime() ?? 0) - Date.now();
    expect(Math.abs(lifetime - 30 * DAY_MS)).toBeLessThan(60_000);

    // Pretend the session was issued two days ago.
    const aged = new Date(Date.now() + 28 * DAY_MS);
    await testAppDb()
      .update(schema.session)
      .set({ expiresAt: aged })
      .where(eq(schema.session.userId, user.id));
    const response = await authRequest(auth, '/get-session', { method: 'GET', cookie });
    expect(response.status).toBe(200);
    const [refreshed] = await testAppDb()
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, user.id));
    expect(refreshed?.expiresAt.getTime()).toBeGreaterThan(aged.getTime() + DAY_MS);
  });

  it('are revoked on sign-out', async () => {
    const { auth } = makeAuth();
    const { user, cookie } = await devSignInAs(auth);
    const response = await authRequest(auth, '/sign-out', { cookie, body: {} });
    expect(response.status).toBe(200);
    expect(sessionSetCookie(response)).toMatch(/Max-Age=0/);
    const rows = await testAppDb()
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, user.id));
    expect(rows).toHaveLength(0);
    const after = await authRequest(auth, '/get-session', { method: 'GET', cookie });
    expect(await after.json()).toBeNull();
  });
});

describe('magic link rate limits', () => {
  it('allows 5 requests per email per 15 minutes, then a generic 429', async () => {
    const { auth } = makeAuth();
    const email = uniqueEmail('limit');
    for (let i = 0; i < 5; i++) {
      expect((await requestLink(auth, email)).status).toBe(200);
    }
    const blocked = await requestLink(auth, email.toUpperCase());
    expect(blocked.status).toBe(429);
    expect((await blocked.json()) as { message: string }).toMatchObject({
      message: RATE_LIMIT_MESSAGE,
    });

    // The window resets after 15 minutes.
    await testAppDb()
      .update(schema.rateLimit)
      .set({ lastRequest: Date.now() - 16 * 60 * 1000 })
      .where(eq(schema.rateLimit.key, magicLinkEmailKey(email)));
    expect((await requestLink(auth, email)).status).toBe(200);
  });

  it('allows 20 requests per IP per hour, then the same generic 429', async () => {
    const { auth } = makeAuth();
    const ip = uniqueIp();
    for (let i = 0; i < 20; i++) {
      expect((await requestLink(auth, uniqueEmail('ip'), ip)).status).toBe(200);
    }
    const blocked = await requestLink(auth, uniqueEmail('ip'), ip);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ message: RATE_LIMIT_MESSAGE });
  });

  it('responds identically for existing and unknown emails once limited', async () => {
    const { auth } = makeAuth();
    const { user } = await devSignInAs(auth, uniqueEmail('known'));
    const unknown = uniqueEmail('unknown');
    const statuses: Record<string, number[]> = { known: [], unknown: [] };
    const bodies: Record<string, string[]> = { known: [], unknown: [] };
    for (let i = 0; i < 6; i++) {
      for (const [label, email] of [
        ['known', user.email],
        ['unknown', unknown],
      ] as const) {
        const response = await requestLink(auth, email);
        statuses[label]?.push(response.status);
        bodies[label]?.push(await response.text());
      }
    }
    expect(statuses.known).toEqual([200, 200, 200, 200, 200, 429]);
    expect(statuses.unknown).toEqual(statuses.known);
    expect(bodies.unknown).toEqual(bodies.known);
  });
});

describe('email enumeration', () => {
  it('gives the same response and sends the same email for known and unknown addresses', async () => {
    const { auth, mailer } = makeAuth();
    const { user } = await devSignInAs(auth, uniqueEmail('exists'));
    const known = await requestLink(auth, user.email);
    const unknown = await requestLink(auth, uniqueEmail('missing'));
    expect(known.status).toBe(unknown.status);
    expect(await known.text()).toBe(await unknown.text());
    await vi.waitFor(() => {
      expect(mailer.sent).toHaveLength(2);
    });
    const [a, b] = mailer.sent;
    expect({ ...a, to: '', url: '' }).toEqual({ ...b, to: '', url: '' });
  });

  it('does not wait for the transport, so delivery time cannot leak', async () => {
    const mailer = recordingMailer();
    let release: () => void = () => undefined;
    mailer.send = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const { auth } = makeAuth({ mailer });
    const response = await Promise.race([
      requestLink(auth, uniqueEmail('slow')),
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => {
          resolve('timeout');
        }, 5_000),
      ),
    ]);
    release();
    expect(response).not.toBe('timeout');
  });

  it('builds auth emails from i18n keys only', async () => {
    const { auth, mailer } = makeAuth();
    await authRequest(auth, '/sign-in/magic-link', {
      body: { email: uniqueEmail('i18n'), metadata: { locale: 'ta' } },
    });
    await vi.waitFor(() => {
      expect(mailer.sent).toHaveLength(1);
    });
    const [message] = mailer.sent;
    expect(message?.subjectKey).toBe(AUTH_EMAIL_KEYS.magicLink.subject);
    expect(message?.bodyKey).toBe(AUTH_EMAIL_KEYS.magicLink.body);
    expect(message?.locale).toBe('ta');
    for (const key of [message?.subjectKey, message?.bodyKey]) {
      expect(key).toMatch(/^auth(\.[A-Za-z]+)+$/);
    }
  });
});

describe('Google provider', () => {
  it('is not configured when AUTH_GOOGLE_ENABLED=false', () => {
    const { auth } = makeAuth();
    expect(auth.options.socialProviders).not.toHaveProperty('google');
  });

  it('is configured when AUTH_GOOGLE_ENABLED=true with validated credentials', () => {
    const { auth } = makeAuth({
      env: {
        AUTH_GOOGLE_ENABLED: true,
        GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: new Secret('google-client-secret'),
      },
    });
    expect(auth.options.socialProviders).toHaveProperty(
      'google.clientId',
      'client-id.apps.googleusercontent.com',
    );
  });

  it('requires credentials at the type level when enabled', () => {
    // @ts-expect-error -- enabled without GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
    const env: Parameters<typeof createAuth>[0]['env'] = {
      ...testEnv(),
      AUTH_GOOGLE_ENABLED: true,
    };
    expect(env.AUTH_GOOGLE_ENABLED).toBe(true);
  });
});

describe('secrets', () => {
  it('accepts BETTER_AUTH_SECRET and the Google secret only as Secret', () => {
    const base = testEnv();
    expect(() =>
      createAuth({
        db: testAppDb(),
        mailer: recordingMailer(),
        // @ts-expect-error -- a plain string is not a #4 Secret.
        env: { ...base, BETTER_AUTH_SECRET: TEST_SECRET },
      }),
    ).toThrow(TypeError);
    const google = {
      ...base,
      AUTH_GOOGLE_ENABLED: true,
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'plain',
    } as const;
    // @ts-expect-error -- a plain string is not a #4 Secret.
    expect(() => createAuth({ db: testAppDb(), mailer: recordingMailer(), env: google })).toThrow(
      TypeError,
    );
  });

  it('never logs BETTER_AUTH_SECRET or the Google client secret', async () => {
    const googleSecret = 'google-client-secret-never-log-me';
    const logger = capturingLogger();
    const consoleLines: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleLines.push(
          args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
        );
      });
    }
    const { auth, mailer } = makeAuth({
      logger,
      env: {
        AUTH_GOOGLE_ENABLED: true,
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: new Secret(googleSecret),
      },
    });
    await devSignInAs(auth);
    const email = uniqueEmail('secret');
    for (let i = 0; i < 6; i++) await requestLink(auth, email);
    await vi.waitFor(() => {
      expect(mailer.sent.length).toBeGreaterThan(0);
    });
    await authRequest(auth, '/sign-in/social', { body: { provider: 'google' } });
    await authRequest(auth, '/does-not-exist', { method: 'GET' });

    const output = [...logger.lines, ...consoleLines].join('\n');
    expect(output).not.toContain(TEST_SECRET);
    expect(output).not.toContain(googleSecret);
    expect(JSON.stringify(testEnv())).not.toContain(TEST_SECRET);
  });
});

describe('session refresh age', () => {
  it('stays a day for the default lifetime and shrinks for short ones', () => {
    expect(sessionUpdateAgeFor(SESSION_EXPIRES_IN_SECONDS)).toBe(SESSION_UPDATE_AGE_SECONDS);
    expect(sessionUpdateAgeFor(8 * 60 * 60)).toBe(2 * 60 * 60);
  });
});

describe('disableSignUp (admin console, #309)', () => {
  it('never creates a user from a magic link for an unknown address', async () => {
    const mailer = recordingMailer();
    const auth = createAuth({
      db: testAppDb(),
      env: testEnv(),
      mailer,
      logger: capturingLogger(),
      disableSignUp: true,
    });
    const email = uniqueEmail('nosignup');
    await requestLink(auth, email);
    await new Promise((resolve) => setTimeout(resolve, 200));
    for (const sent of mailer.sent) {
      const verify = await authRequest(auth, sent.url, { method: 'GET' });
      expect(sessionSetCookie(verify)).toBeUndefined();
    }
    expect(await findUser(email)).toBeUndefined();
  });
});

describe('two-factor without a password (#289)', () => {
  it('lets a passwordless user enable TOTP with the session alone, then verify it', async () => {
    const twoFactorEnabled = vi.fn(() => Promise.resolve());
    const { auth } = makeAuth({
      securityEvents: {
        signInSucceeded: () => Promise.resolve(),
        signInFailed: () => Promise.resolve(),
        magicLinkRequested: () => Promise.resolve(),
        passkeyAdded: () => Promise.resolve(),
        passkeyRemoved: () => Promise.resolve(),
        twoFactorEnabled,
        twoFactorDisabled: () => Promise.resolve(),
        sessionRevoked: () => Promise.resolve(),
      },
    });
    // Dev sign-in creates no credential account: the user has no password at all.
    const { user, cookie } = await devSignInAs(auth);
    const enable = await authRequest(auth, '/two-factor/enable', { cookie, body: {} });
    expect(enable.status).toBe(200);
    const { totpURI, backupCodes } = (await enable.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(totpURI).toMatch(/^otpauth:\/\/totp\/CauseDeck:/);
    expect(backupCodes.length).toBeGreaterThan(0);
    // Not enabled until the first code is verified.
    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(false);

    const secret = new URL(totpURI).searchParams.get('secret') ?? '';
    const verify = await authRequest(auth, '/two-factor/verify-totp', {
      cookie,
      body: { code: totp(secret) },
    });
    expect(verify.status).toBe(200);
    // Verification rotates the session: a fresh session cookie comes back.
    expect(cookieHeader(verify)).toContain('session_token=');
    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(true);
    expect(twoFactorEnabled).toHaveBeenCalledTimes(1);
  });
});

async function findUserById(id: string) {
  const [row] = await testAppDb().select().from(schema.user).where(eq(schema.user.id, id));
  return row;
}
