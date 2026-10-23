// Shared fixtures for the API tests: a real `createAuth` on the #6 Testcontainers database.
// Better Auth commits its own writes, so tests isolate by unique emails and client IPs.
import { createHmac, randomInt, randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import type { Database } from '@causedeck/db';
import { testAppDb } from '@causedeck/db/testing';

import type { AuthEmail, AuthLogger, Mailer } from '../mailer';
import { createAuth, type AuthEnv, type SecurityEventRecorder } from '../server';

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
  options: {
    env?: Partial<AuthEnv>;
    mailer?: RecordingMailer;
    logger?: AuthLogger;
    /** Defaults to the shared app-role client. */
    db?: Database;
    /** Defaults to the no-op recorder. */
    securityEvents?: SecurityEventRecorder;
  } = {},
) {
  const mailer = options.mailer ?? recordingMailer();
  const logger = options.logger ?? capturingLogger();
  const db = options.db ?? testAppDb();
  const auth = createAuth({
    db,
    env: testEnv(options.env),
    mailer,
    logger,
    ...(options.securityEvents ? { securityEvents: options.securityEvents } : {}),
  });
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

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret. */
export function totp(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}
