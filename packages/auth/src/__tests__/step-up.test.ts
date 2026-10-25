// Step-up freshness (#304): `requireStepUp` reads `session.step_up_at`; `createAuth` stamps it for
// passkey or TOTP ceremonies only.
import { randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  isFreshStepUp,
  markStepUp,
  requireStepUp,
  STEP_UP_MAX_AGE_MS,
  StepUpRequiredError,
} from '../step-up';
import { stepUpHook } from '../server';
import { devSignInAs, makeAuth } from './helpers';

afterAll(closeTestDb);

const MIN = 60 * 1000;
const NOW = new Date('2026-10-20T12:00:00.000Z');

async function newUser(): Promise<string> {
  const [row] = await testAppDb()
    .insert(schema.user)
    .values({ name: 'Step Up', email: `step-up-${randomUUID()}@example.in` })
    .returning({ id: schema.user.id });
  if (row === undefined) throw new Error('no user');
  return row.id;
}

async function newSession(
  userId: string,
  {
    stepUpAt,
    expiresAt = new Date(NOW.getTime() + 60 * MIN),
  }: {
    stepUpAt: Date | null;
    expiresAt?: Date;
  },
): Promise<string> {
  const [row] = await testAppDb()
    .insert(schema.session)
    .values({ token: randomUUID(), userId, expiresAt, stepUpAt })
    .returning({ id: schema.session.id });
  if (row === undefined) throw new Error('no session');
  return row.id;
}

async function stepUpAtOf(sessionId: string): Promise<Date | null | undefined> {
  const [row] = await testAppDb()
    .select({ stepUpAt: schema.session.stepUpAt })
    .from(schema.session)
    .where(eq(schema.session.id, sessionId));
  return row?.stepUpAt;
}

const check = (sessionId: string, userId: string, maxAgeMs?: number) =>
  requireStepUp(
    { db: testAppDb(), sessionId, userId, now: () => NOW },
    maxAgeMs === undefined ? {} : { maxAgeMs },
  ).then(
    () => 'ok',
    (error: unknown) => (error instanceof StepUpRequiredError ? error.code : 'other'),
  );

describe('isFreshStepUp', () => {
  it('accepts [now - maxAge, now) only', () => {
    expect(STEP_UP_MAX_AGE_MS).toBe(600_000);
    expect(isFreshStepUp(NOW, NOW, STEP_UP_MAX_AGE_MS)).toBe(true);
    expect(isFreshStepUp(new Date(NOW.getTime() - 9 * MIN), NOW, STEP_UP_MAX_AGE_MS)).toBe(true);
    expect(isFreshStepUp(new Date(NOW.getTime() - 10 * MIN), NOW, STEP_UP_MAX_AGE_MS)).toBe(false);
    expect(isFreshStepUp(new Date(NOW.getTime() + 1000), NOW, STEP_UP_MAX_AGE_MS)).toBe(false);
    expect(isFreshStepUp(null, NOW, STEP_UP_MAX_AGE_MS)).toBe(false);
  });
});

describe('requireStepUp', () => {
  it('passes a live session of the user verified within 10 minutes', async () => {
    const userId = await newUser();
    const id = await newSession(userId, { stepUpAt: new Date(NOW.getTime() - 5 * MIN) });
    expect(await check(id, userId)).toBe('ok');
  });

  it('refuses with FORBIDDEN: stale, boundary, future, never verified', async () => {
    const userId = await newUser();
    for (const stepUpAt of [
      new Date(NOW.getTime() - 11 * MIN),
      new Date(NOW.getTime() - 10 * MIN),
      new Date(NOW.getTime() + MIN),
      null,
    ]) {
      expect(await check(await newSession(userId, { stepUpAt }), userId)).toBe('FORBIDDEN');
    }
  });

  it("refuses another user's session, an expired session and an unknown id", async () => {
    const userId = await newUser();
    const other = await newUser();
    const fresh = await newSession(other, { stepUpAt: NOW });
    expect(await check(fresh, userId)).toBe('FORBIDDEN');
    const expired = await newSession(userId, {
      stepUpAt: NOW,
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    expect(await check(expired, userId)).toBe('FORBIDDEN');
    expect(await check(randomUUID(), userId)).toBe('FORBIDDEN');
  });

  it('honours a custom maxAgeMs', async () => {
    const userId = await newUser();
    const id = await newSession(userId, { stepUpAt: new Date(NOW.getTime() - 2 * MIN) });
    expect(await check(id, userId, MIN)).toBe('FORBIDDEN');
    expect(await check(id, userId, 3 * MIN)).toBe('ok');
  });
});

describe('markStepUp', () => {
  it('stamps only the given session', async () => {
    const userId = await newUser();
    const a = await newSession(userId, { stepUpAt: null });
    const b = await newSession(userId, { stepUpAt: null });
    await markStepUp(testAppDb(), a, NOW);
    expect((await stepUpAtOf(a))?.toISOString()).toBe(NOW.toISOString());
    expect(await stepUpAtOf(b)).toBeNull();
  });
});

describe('stepUpHook (signed-in TOTP re-verification)', () => {
  it('stamps the current session after a successful verify-totp, and nothing else', async () => {
    const userId = await newUser();
    const id = await newSession(userId, { stepUpAt: null });
    const hook = stepUpHook(testAppDb());
    const session = { session: { id } };

    // Other paths, failures and session-creating verifies leave it alone.
    await hook({ path: '/two-factor/verify-backup-code', context: { session } });
    await hook({ path: '/magic-link/verify', context: { session } });
    await hook({
      path: '/two-factor/verify-totp',
      context: { session, newSession: { session: { id: randomUUID() } } },
    });
    const { APIError } = await import('better-auth/api');
    await hook({
      path: '/two-factor/verify-totp',
      context: { session, returned: new APIError('UNAUTHORIZED', { message: 'Invalid code' }) },
    });
    expect(await stepUpAtOf(id)).toBeNull();

    const before = Date.now();
    await hook({ path: '/two-factor/verify-totp', context: { session, returned: { token: 'x' } } });
    expect((await stepUpAtOf(id))?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe('createAuth stamps sessions', () => {
  it('a magic-link or dev sign-in session has no step-up', async () => {
    const { auth } = makeAuth();
    const { user } = await devSignInAs(auth);
    const rows = await testAppDb()
      .select({ stepUpAt: schema.session.stepUpAt })
      .from(schema.session)
      .where(eq(schema.session.userId, user.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.stepUpAt === null)).toBe(true);
  });
});
