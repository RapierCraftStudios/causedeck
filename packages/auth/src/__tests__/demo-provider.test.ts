// Demo sign-in (#93): a session for an ephemeral visitor that ends after the lifetime the app
// gives, is never refreshed past it, and is refused (404/400/429) when the app cannot create the
// visitor. The endpoint only exists when the app passes `demo`.
import { Secret } from '@causedeck/config/env';
import { schema, withWorkspace, type Database } from '@causedeck/db';
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { DEMO_SIGN_IN_PATH, type DemoEntry } from '../demo-provider';
import { createAuth } from '../server';

import {
  authRequest,
  cookieHeader,
  recordingMailer,
  TEST_SECRET,
  testEnv,
  uniqueEmail,
} from './helpers';

afterAll(closeTestDb);

const FOUR_HOURS = 4 * 60 * 60 * 1000;

async function visitorIn(db: Database) {
  const [row] = await db
    .insert(schema.user)
    .values({
      name: 'Demo visitor (fictional)',
      email: uniqueEmail('visitor'),
      emailVerified: true,
    })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

async function demoWorkspaceIn(db: Database) {
  const id = randomUUID();
  await withWorkspace(db, { workspaceId: id }, (tx) =>
    tx
      .insert(schema.organization)
      .values({ id, name: 'Demo (fictional)', slug: `demo-${id}`, isDemo: true }),
  );
  return id;
}

function authWith(entry: DemoEntry | undefined) {
  return createAuth({
    db: testAppDb(),
    env: testEnv({ BETTER_AUTH_SECRET: new Secret(TEST_SECRET) }),
    mailer: recordingMailer(),
    ...(entry ? { demo: entry } : {}),
  });
}

describe('demo sign-in provider', () => {
  it('is not mounted unless the app passes demo', async () => {
    const response = await authRequest(authWith(undefined), DEMO_SIGN_IN_PATH, {
      body: { workspace: 'chennai-solo' },
    });
    expect(response.status).toBe(404);
  });

  it('opens a browser-session cookie and a session that ends at the visitor expiry', async () => {
    const db = testAppDb();
    const userId = await visitorIn(db);
    const workspaceId = await demoWorkspaceIn(db);
    const expiresAt = new Date(Date.now() + FOUR_HOURS);
    const auth = authWith({
      enter: (workspace) =>
        Promise.resolve({ userId, workspaceId, slug: `demo-${workspace}`, expiresAt }),
    });
    const response = await authRequest(auth, DEMO_SIGN_IN_PATH, {
      body: { workspace: 'chennai-solo' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      slug: 'demo-chennai-solo',
      expiresAt: expiresAt.toISOString(),
    });
    const cookie = cookieHeader(response);
    expect(cookie).toContain('session_token=');
    // A session cookie (no Max-Age) that is also marked "do not remember", so it never refreshes.
    const setCookies = response.headers.getSetCookie();
    const sessionCookie = setCookies.find((c) => c.includes('session_token='));
    expect(sessionCookie).not.toMatch(/max-age/i);
    expect(setCookies.some((c) => c.includes('dont_remember'))).toBe(true);

    const [row] = await db.select().from(schema.session).where(eq(schema.session.userId, userId));
    expect(row?.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(row?.activeOrganizationId).toBe(workspaceId);
  });

  it('keeps the 4-hour expiry when the session is read later', async () => {
    const db = testAppDb();
    const userId = await visitorIn(db);
    const workspaceId = await demoWorkspaceIn(db);
    const expiresAt = new Date(Date.now() + FOUR_HOURS);
    const auth = authWith({
      enter: () => Promise.resolve({ userId, workspaceId, slug: 'demo-x', expiresAt }),
    });
    const entered = await authRequest(auth, DEMO_SIGN_IN_PATH, {
      body: { workspace: 'chennai-solo' },
    });
    const cookie = cookieHeader(entered);
    await authRequest(auth, '/get-session', { method: 'GET', cookie });
    await authRequest(auth, '/get-session', { method: 'GET', cookie });
    const [row] = await db.select().from(schema.session).where(eq(schema.session.userId, userId));
    expect(row?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it.each([
    ['NOT_FOUND', 404],
    ['VALIDATION', 400],
    ['RATE_LIMITED', 429],
  ])('maps %s from the app to HTTP %i and creates no session', async (code, status) => {
    const auth = authWith({
      enter: () => Promise.reject(Object.assign(new Error('nope'), { code })),
    });
    const response = await authRequest(auth, DEMO_SIGN_IN_PATH, {
      body: { workspace: 'chennai-solo' },
    });
    expect(response.status).toBe(status);
    expect(cookieHeader(response)).not.toContain('session_token=');
  });
});
