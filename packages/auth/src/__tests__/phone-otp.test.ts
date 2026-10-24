// Phone OTP sign-in (#503) against a real `createAuth` on the Testcontainers database: sign-up and
// sign-in, expiry, the attempt cap, the per-phone and per-IP limits, disableSignUp, and linking an
// email to a phone account.
import { createHash } from 'node:crypto';

import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  PHONE_OTP_IP_LIMIT,
  PHONE_OTP_PHONE_LIMIT,
  phoneOtpKey,
  RATE_LIMIT_MESSAGE,
} from '../rate-limit';
import {
  isPhoneTempEmail,
  PHONE_OTP_ALLOWED_ATTEMPTS,
  PHONE_OTP_EXPIRES_IN_SECONDS,
  PHONE_OTP_SEND_PATH,
  PHONE_OTP_VERIFY_PATH,
  signInMethod,
} from '../server';
import { consoleSmsSender, maskPhone } from '../sms';
import {
  authRequest,
  capturingLogger,
  cookieHeader,
  makeAuth,
  recordingSms,
  uniqueEmail,
  uniqueIp,
  uniquePhone,
} from './helpers';

afterAll(closeTestDb);
afterEach(() => {
  vi.useRealTimers();
});

function setup(env: Parameters<typeof makeAuth>[0] = {}) {
  const sms = recordingSms();
  const { auth, logger } = makeAuth({ ...env, sms });
  return { auth, sms, logger };
}

async function sendCode(auth: ReturnType<typeof setup>['auth'], phoneNumber: string, ip?: string) {
  const response = await authRequest(auth, PHONE_OTP_SEND_PATH, {
    body: { phoneNumber },
    ...(ip ? { ip } : {}),
  });
  // The SMS send is fire-and-forget.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return response;
}

function verify(auth: ReturnType<typeof setup>['auth'], phoneNumber: string, code: string) {
  return authRequest(auth, PHONE_OTP_VERIFY_PATH, { body: { phoneNumber, code } });
}

describe('phone OTP sign-in', () => {
  it('signs up on first verification and signs in on the next', async () => {
    const { auth, sms } = setup();
    const phone = uniquePhone();

    expect((await sendCode(auth, phone)).status).toBe(200);
    const first = sms.sent.at(-1);
    expect(first).toMatchObject({ phoneNumber: phone, expiresInMinutes: 5 });
    expect(first?.code).toMatch(/^\d{6}$/);

    const signUp = await verify(auth, phone, first?.code ?? '');
    expect(signUp.status).toBe(200);
    const body = (await signUp.json()) as { user: { email: string; phoneNumberVerified: boolean } };
    expect(isPhoneTempEmail(body.user.email)).toBe(true);
    expect(body.user.phoneNumberVerified).toBe(true);
    expect(cookieHeader(signUp)).toContain('session_token=');

    await sendCode(auth, phone);
    const second = await verify(auth, phone, sms.sent.at(-1)?.code ?? '');
    expect(second.status).toBe(200);
    const again = (await second.json()) as { user: { id: string } };
    const firstBody = body as unknown as { user: { id: string } };
    expect(again.user.id).toBe(firstBody.user.id);
  });

  it('rejects a wrong code and locks the code after the allowed attempts', async () => {
    const { auth, sms } = setup();
    const phone = uniquePhone();
    await sendCode(auth, phone);
    const real = sms.sent.at(-1)?.code ?? '';
    const wrong = real === '000000' ? '000001' : '000000';

    for (let i = 0; i < PHONE_OTP_ALLOWED_ATTEMPTS; i += 1) {
      expect((await verify(auth, phone, wrong)).status).toBe(400);
    }
    const last = await verify(auth, phone, real);
    expect(last.status, await last.clone().text()).toBe(403);
  });

  it('rejects an expired code', async () => {
    const { auth, sms } = setup();
    const phone = uniquePhone();
    await sendCode(auth, phone);
    const code = sms.sent.at(-1)?.code ?? '';

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + (PHONE_OTP_EXPIRES_IN_SECONDS + 1) * 1000);
    expect((await verify(auth, phone, code)).status).toBe(400);
  });

  it('rate-limits sends per phone number', async () => {
    const { auth } = setup();
    const phone = uniquePhone();
    for (let i = 0; i < PHONE_OTP_PHONE_LIMIT.max; i += 1) {
      expect((await sendCode(auth, phone)).status).toBe(200);
    }
    const blocked = await sendCode(auth, phone);
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toContain(RATE_LIMIT_MESSAGE);
  });

  it('rate-limits sends per IP', async () => {
    const { auth } = setup();
    const ip = uniqueIp();
    for (let i = 0; i < PHONE_OTP_IP_LIMIT.max; i += 1) {
      expect((await sendCode(auth, uniquePhone(), ip)).status).toBe(200);
    }
    expect((await sendCode(auth, uniquePhone(), ip)).status).toBe(429);
  });

  it('rejects a number that is not E.164', async () => {
    const { auth, sms } = setup();
    expect((await sendCode(auth, '98765 43210')).status).toBe(400);
    expect(sms.sent).toHaveLength(0);
  });

  it('does not create an account when sign-up is disabled', async () => {
    const sms = recordingSms();
    const disabled = (await import('../server')).createAuth({
      db: testAppDb(),
      env: { ...(await import('./helpers')).testEnv() },
      mailer: { send: () => Promise.resolve() },
      sms,
      disableSignUp: true,
    });
    const phone = uniquePhone();
    await authRequest(disabled, PHONE_OTP_SEND_PATH, { body: { phoneNumber: phone } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const response = await authRequest(disabled, PHONE_OTP_VERIFY_PATH, {
      body: { phoneNumber: phone, code: sms.sent.at(-1)?.code ?? '' },
    });
    expect(response.status).not.toBe(200);
    expect(cookieHeader(response)).not.toContain('session_token=');
  });

  it('does not mount the endpoints without an sms sender', async () => {
    const { auth } = makeAuth();
    expect((await sendCode(auth, uniquePhone())).status).toBe(404);
  });
});

describe('linking to a phone account', () => {
  it('lets a phone-only account add an email, and refuses email accounts', async () => {
    const { auth, sms } = setup();
    const phone = uniquePhone();
    await sendCode(auth, phone);
    const signUp = await verify(auth, phone, sms.sent.at(-1)?.code ?? '');
    const cookie = cookieHeader(signUp);

    const email = uniqueEmail('phone');
    const change = await authRequest(auth, '/change-email', {
      cookie,
      body: { newEmail: email },
    });
    expect(change.status).toBe(200);
    const session = (await (
      await authRequest(auth, '/get-session', { cookie, method: 'GET' })
    ).json()) as { user: { email: string } };
    expect(session.user.email).toBe(email);

    const second = await authRequest(auth, '/change-email', {
      cookie,
      body: { newEmail: uniqueEmail('again') },
    });
    expect(second.status).toBe(403);
  });
});

describe('helpers', () => {
  it('hashes the phone number in the rate-limit key', () => {
    const key = phoneOtpKey('+919876543210');
    expect(key).toBe(
      `phone-otp:phone:${createHash('sha256').update('+919876543210').digest('hex')}`,
    );
    expect(key).not.toContain('9876543210');
  });

  it('maps the verify path to the phone_otp method', () => {
    expect(signInMethod(PHONE_OTP_VERIFY_PATH)).toBe('phone_otp');
  });

  it('never logs the code or the full number in production', async () => {
    const logger = capturingLogger();
    await consoleSmsSender(logger, { includeCode: false }).send({
      phoneNumber: '+919876543210',
      code: '123456',
      expiresInMinutes: 5,
    });
    const line = logger.lines.join('\n');
    expect(line).not.toContain('123456');
    expect(line).not.toContain('9876543210');
    expect(line).toContain(maskPhone('+919876543210'));
  });
});
