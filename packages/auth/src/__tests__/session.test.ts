import { closeTestDb } from '@causedeck/db/testing';
import { afterAll, describe, expect, it } from 'vitest';

import { UnauthenticatedError as RootUnauthenticatedError } from '../index';
import { createSessionHelpers, UnauthenticatedError } from '../session';
import { devSignInAs, makeAuth, uniqueEmail } from './helpers';

afterAll(closeTestDb);

function helpersWith(cookie?: string) {
  const { auth } = makeAuth();
  const headers = new Headers(cookie ? { cookie } : {});
  return { auth, ...createSessionHelpers({ auth, headers: () => headers }) };
}

describe('requireSession()', () => {
  it('throws a typed UnauthenticatedError without a session cookie', async () => {
    const { requireSession, requireUser, getSession } = helpersWith();
    expect(await getSession()).toBeNull();
    const error: unknown = await requireSession().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect(error).toMatchObject({ name: 'UnauthenticatedError', code: 'UNAUTHENTICATED' });
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(RootUnauthenticatedError).toBe(UnauthenticatedError);
  });

  it('throws for a forged or revoked session cookie', async () => {
    const { requireSession } = helpersWith('better-auth.session_token=forged.token');
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe('getSession() / requireUser()', () => {
  it('return the SessionUser shape for a valid session', async () => {
    const { auth } = makeAuth();
    const email = uniqueEmail('session');
    const { user, cookie } = await devSignInAs(auth, email);
    const headers = new Headers({ cookie });
    const { getSession, requireSession, requireUser } = createSessionHelpers({
      auth,
      headers: () => Promise.resolve(headers),
    });

    expect(await requireUser()).toEqual({
      id: user.id,
      email,
      name: null,
      image: null,
      locale: 'en',
    });
    const session = await getSession();
    expect(session?.user.id).toBe(user.id);
    expect((await requireSession()).user.email).toBe(email);
  });
});
