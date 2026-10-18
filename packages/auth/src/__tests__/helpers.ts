// Shared fixtures for the API tests: a real `createAuth` on the #6 Testcontainers database.
// Better Auth commits its own writes, so tests isolate by unique emails and client IPs.
import { randomInt, randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { testAppDb } from '@causedeck/db/testing';

import type { AuthEmail, AuthLogger, Mailer } from '../mailer';
import { createAuth, type AuthEnv } from '../server';

export const APP_URL = 'http://localhost:3000';
export const TEST_SECRET = 'test-only-better-auth-secret-0123456789abcdef';

export function testEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
  return {
    NODE_ENV: 'test',
    APP_URL,
    BETTER_AUTH_SECRET: new Secret(TEST_SECRET),
    AUTH_GOOGLE_ENABLED: false,
    ...overrides,
  } as AuthEnv;
}

export interface RecordingMailer extends Mailer {
  sent: AuthEmail[];
}

export function recordingMailer(): RecordingMailer {
  const sent: AuthEmail[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

export interface CapturingLogger extends AuthLogger {
  lines: string[];
}

export function capturingLogger(): CapturingLogger {
  const lines: string[] = [];
  const write = (obj: object, msg?: string) => {
    lines.push(`${msg ?? ''} ${JSON.stringify(obj)}`);
  };
  return { lines, debug: write, info: write, warn: write, error: write };
}

export function makeAuth(
  options: { env?: Partial<AuthEnv>; mailer?: RecordingMailer; logger?: AuthLogger } = {},
) {
  const mailer = options.mailer ?? recordingMailer();
  const logger = options.logger ?? capturingLogger();
  const auth = createAuth({ db: testAppDb(), env: testEnv(options.env), mailer, logger });
  return { auth, mailer, logger };
}

export type TestAuth = ReturnType<typeof makeAuth>['auth'];

export function uniqueEmail(label = 'user'): string {
  return `${label}-${randomUUID()}@example.in`;
}

/** A fresh client IP, so the per-IP limits of one test never touch another. */
export function uniqueIp(): string {
  return ['10', randomInt(256), randomInt(256), randomInt(1, 255)].join('.');
}

export interface RequestOptions {
  ip?: string;
  cookie?: string;
  method?: 'GET' | 'POST';
  body?: unknown;
}

export function authRequest(
  auth: TestAuth,
  pathOrUrl: string,
  { ip = uniqueIp(), cookie, method = 'POST', body }: RequestOptions = {},
): Promise<Response> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${APP_URL}/api/auth${pathOrUrl}`;
  const headers = new Headers({ origin: APP_URL, 'x-forwarded-for': ip });
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return auth.handler(new Request(url, init));
}

/** `name=value` pairs from every Set-Cookie header, for sending back as a Cookie header. */
export function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

export function sessionSetCookie(response: Response): string | undefined {
  return response.headers.getSetCookie().find((c) => c.includes('session_token='));
}

export async function devSignInAs(auth: TestAuth, email = uniqueEmail()) {
  const response = await authRequest(auth, '/dev/sign-in', { body: { email } });
  if (response.status !== 200) throw new Error(`dev sign-in failed: ${String(response.status)}`);
  const { user } = (await response.json()) as { user: { id: string; email: string } };
  return { user, cookie: cookieHeader(response), response };
}
