import { UnauthenticatedError, type SessionUser } from '@causedeck/auth';
import type { AuthSession } from '@causedeck/auth/session';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  ACTION_ERROR_CODES,
  ActionError,
  safeAction,
  type ActionCtx,
  type ActionErrorCode,
} from '../lib/safe-action.ts';
import { logger } from '../src/health.ts';

// Unit tests have no Next request scope; stand in for `lib/auth.ts` (the default session source).
const auth = vi.hoisted(() => ({ session: null as AuthSession | null }));
vi.mock('../lib/auth.ts', () => ({ getSession: () => Promise.resolve(auth.session) }));

const user: SessionUser = {
  id: '0b0e8f7c-0000-4000-8000-000000000001',
  email: 'advocate@example.com',
  name: 'A. Advocate',
  image: null,
  locale: 'en',
};
const signedIn: AuthSession = { session: { id: 'session-1' }, user };

const schema = z.object({ title: z.string().min(3), court: z.string() });

afterEach(() => {
  vi.restoreAllMocks();
  auth.session = null;
});

describe('safeAction', () => {
  it('exposes exactly the stable error code set', () => {
    expect(ACTION_ERROR_CODES).toEqual([
      'VALIDATION',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'INTERNAL',
    ]);
  });

  it('returns {ok:true,data} and passes the parsed input and a context', async () => {
    const handler = vi.fn((input: { title: string }) => Promise.resolve(input.title.toUpperCase()));
    const action = safeAction(schema, handler);

    await expect(action({ title: 'bail', court: 'HC', extra: 1 })).resolves.toEqual({
      ok: true,
      data: 'BAIL',
    });
    expect(handler).toHaveBeenCalledWith(
      { title: 'bail', court: 'HC' },
      expect.objectContaining({ requestId: expect.any(String) as string }),
    );
  });

  it('rejects invalid input with field errors and never calls the handler', async () => {
    const handler = vi.fn(() => Promise.resolve('never'));
    const result = await safeAction(schema, handler)({ title: 'ab' });

    expect(handler).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION');
    expect(Object.keys(result.error.fieldErrors ?? {}).sort()).toEqual(['court', 'title']);
    expect(result.error.fieldErrors?.title?.[0]).toEqual(expect.any(String));
  });

  it('puts form-level issues under _form', async () => {
    const result = await safeAction(z.string(), () => Promise.resolve('x'))(42);
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    if (result.ok) return;
    expect(result.error.fieldErrors).toHaveProperty('_form');
  });

  it.each(ACTION_ERROR_CODES.filter((code) => code !== 'INTERNAL'))(
    'maps ActionError(%s) to its code',
    async (code: ActionErrorCode) => {
      const result = await safeAction(schema, () =>
        Promise.reject(new ActionError(code, 'client-safe message', { title: ['taken'] })),
      )({ title: 'bail', court: 'HC' });

      expect(result).toEqual({
        ok: false,
        error: { code, message: 'client-safe message', fieldErrors: { title: ['taken'] } },
      });
    },
  );

  it('turns unknown errors into INTERNAL without leaking the message or stack, and logs them', async () => {
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const secret = new Error('connection to db-prod-1 refused: password=hunter2');

    const result = await safeAction(schema, () => Promise.reject(secret))({
      title: 'bail',
      court: 'HC',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('hunter2');
    expect(serialised).not.toContain('db-prod-1');
    expect(serialised).not.toContain('at ');
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ err: secret, requestId: expect.any(String) as string }),
      'server action failed',
    );
  });

  it('never rejects, even for non-Error throws', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const action = safeAction(schema, () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the case under test.
      throw 'boom';
    });
    await expect(action({ title: 'bail', court: 'HC' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' },
    });
  });

  describe('sessions (#153)', () => {
    it('maps UnauthenticatedError to UNAUTHENTICATED with the generic copy and does not log it', async () => {
      const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      const result = await safeAction(schema, () => Promise.reject(new UnauthenticatedError()))({
        title: 'bail',
        court: 'HC',
      });

      expect(result).toEqual({
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: 'Please sign in again.' },
      });
      expect(logged).not.toHaveBeenCalled();
    });

    it('maps an UnauthenticatedError thrown while resolving the session', async () => {
      const action = safeAction(schema, () => Promise.resolve('never'), {
        getSession: () => Promise.reject(new UnauthenticatedError()),
      });
      await expect(action({ title: 'bail', court: 'HC' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'UNAUTHENTICATED' },
      });
    });

    it('passes the session from lib/auth.ts as ctx.session by default', async () => {
      auth.session = signedIn;
      const handler = vi.fn((_input: unknown, ctx: ActionCtx) => Promise.resolve(ctx.session));
      const result = await safeAction(schema, handler)({ title: 'bail', court: 'HC' });
      expect(result).toEqual({ ok: true, data: signedIn });
    });

    it('sets ctx.session to null when signed out', async () => {
      const handler = vi.fn((_input: unknown, ctx: ActionCtx) => Promise.resolve(ctx.session));
      await expect(safeAction(schema, handler)({ title: 'bail', court: 'HC' })).resolves.toEqual({
        ok: true,
        data: null,
      });
    });

    it('uses an injected session source', async () => {
      const getSession = vi.fn(() => Promise.resolve(signedIn));
      const handler = (_input: unknown, ctx: ActionCtx) => Promise.resolve(ctx.session?.user.id);
      const result = await safeAction(schema, handler, { getSession })({
        title: 'bail',
        court: 'HC',
      });
      expect(result).toEqual({ ok: true, data: user.id });
      expect(getSession).toHaveBeenCalledOnce();
    });

    it('does not resolve the session for invalid input', async () => {
      const getSession = vi.fn(() => Promise.resolve(signedIn));
      await safeAction(schema, () => Promise.resolve('x'), { getSession })({ title: 'ab' });
      expect(getSession).not.toHaveBeenCalled();
    });
  });
});
