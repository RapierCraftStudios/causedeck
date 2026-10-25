// Shared fixtures: the real `createApp` and a real Better Auth on the #6 Testcontainers database.
// Better Auth commits its writes, so tests isolate by unique users, workspaces and client IPs.
import { randomInt, randomUUID } from 'node:crypto';

import type { Mailer } from '@causedeck/auth/mailer';
import { createAuth, type AuthEnv } from '@causedeck/auth/server';
import { Secret } from '@causedeck/config/env';
import { schema, testAppDb, withWorkspace } from '@causedeck/db/testing';
import { createLogger } from '@causedeck/observability';
import { Writable } from 'node:stream';

import { createApp, type AppDeps } from '../app.ts';

export const APP_URL = 'http://localhost:3000';
export const API = 'http://localhost:3001';

const TEST_SECRET = 'test-only-better-auth-secret-0123456789abcdef';

function testEnv(): AuthEnv {
  return {
    NODE_ENV: 'test',
    APP_URL,
    BETTER_AUTH_SECRET: new Secret(TEST_SECRET),
    AUTH_GOOGLE_ENABLED: false,
  };
}

const silentMailer: Mailer = {
  send: () => Promise.resolve(),
};

const quiet = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

let auth: ReturnType<typeof createAuth> | undefined;

export function testAuth(): ReturnType<typeof createAuth> {
  return (auth ??= createAuth({
    db: testAppDb(),
    env: testEnv(),
    mailer: silentMailer,
    logger: quiet,
  }));
}

/** A logger whose JSON lines are collected in `lines`. */
export function memoryLogger() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim() !== '') lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      callback();
    },
  });
  return { logger: createLogger({ service: 'api', level: 'debug', destination }), lines };
}

export function makeApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    db: testAppDb(),
    auth: testAuth(),
    logger: memoryLogger().logger,
    allowedOrigins: [APP_URL],
    ...overrides,
    rateLimit: { trustProxy: true, ...overrides.rateLimit },
  });
}

export function uniqueEmail(label = 'user'): string {
  return `${label}-${randomUUID()}@example.in`;
}

export function uniqueIp(): string {
  return ['10', randomInt(256), randomInt(256), randomInt(1, 255)].join('.');
}

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

/** Sign a fresh user in through Better Auth's dev provider; returns their session cookie. */
export async function signIn(email = uniqueEmail()): Promise<TestUser> {
  const response = await testAuth().handler(
    new Request(`${APP_URL}/api/auth/dev/sign-in`, {
      method: 'POST',
      headers: {
        origin: APP_URL,
        'content-type': 'application/json',
        'x-forwarded-for': uniqueIp(),
      },
      body: JSON.stringify({ email }),
    }),
  );
  if (response.status !== 200) throw new Error(`dev sign-in failed: ${String(response.status)}`);
  const { user } = (await response.json()) as { user: { id: string; email: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { id: user.id, email: user.email, cookie };
}

/** Create a workspace with `userId` as a member. */
export async function createWorkspace(
  userId: string,
  role: (typeof schema.member.$inferInsert)['role'] = 'owner',
  name = `Chambers ${randomUUID().slice(0, 8)}`,
): Promise<{ id: string; name: string; slug: string }> {
  // Written inside the new workspace's scope, as createWorkspace does (FORCE RLS, #19).
  const id = randomUUID();
  const slug = `ws-${randomUUID()}`;
  const [workspace] = await withWorkspace(testAppDb(), { workspaceId: id }, (tx) =>
    tx.insert(schema.organization).values({ id, name, slug }).returning({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
    }),
  );
  if (!workspace) throw new Error('workspace insert failed');
  await addMember(workspace.id, userId, role);
  return workspace;
}

export async function addMember(
  workspaceId: string,
  userId: string,
  role: (typeof schema.member.$inferInsert)['role'] = 'advocate',
): Promise<void> {
  await withWorkspace(testAppDb(), { workspaceId }, (tx) =>
    tx.insert(schema.member).values({ organizationId: workspaceId, userId, role }),
  );
}

export interface CallOptions {
  method?: string;
  cookie?: string;
  bearer?: string;
  origin?: string | null;
  ip?: string;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
}

/** `app.request()` with the headers a browser or API client would send. */
export function call(
  app: { request: (input: string, init?: RequestInit) => Response | Promise<Response> },
  path: string,
  {
    method = 'GET',
    cookie,
    bearer,
    origin,
    ip = uniqueIp(),
    headers = {},
    body,
    rawBody,
  }: CallOptions = {},
): Promise<Response> {
  const h = new Headers({ 'x-forwarded-for': ip, ...headers });
  if (cookie) h.set('cookie', cookie);
  if (bearer) h.set('authorization', `Bearer ${bearer}`);
  if (origin !== null && (origin !== undefined || cookie)) h.set('origin', origin ?? APP_URL);
  const init: RequestInit = { method, headers: h };
  if (body !== undefined) {
    h.set('content-type', 'application/json');
    init.body = JSON.stringify(body);
  } else if (rawBody !== undefined) {
    h.set('content-type', 'application/json');
    init.body = rawBody;
  }
  return Promise.resolve(app.request(`${API}${path}`, init));
}

export async function problemOf(response: Response) {
  expectProblemContentType(response);
  return (await response.json()) as {
    type: string;
    title: string;
    status: number;
    detail?: string;
    code: string;
    requestId: string;
    errors?: { path: string; message: string }[];
  };
}

function expectProblemContentType(response: Response): void {
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('application/problem+json')) {
    throw new Error(`expected problem+json, got ${type} (${String(response.status)})`);
  }
}
