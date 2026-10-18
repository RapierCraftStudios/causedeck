// Session helpers for RSC and server actions (#152). Framework-free: apps/web passes `next/headers`
// in (#153), so this module never imports Next.
import { toAuthLocale, type AuthLocale } from './messages';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  locale: AuthLocale;
}

/** No valid session. `safeAction` (#153) maps `code` to its `UNAUTHENTICATED` result. */
export class UnauthenticatedError extends Error {
  readonly code = 'UNAUTHENTICATED' as const;

  constructor(message = 'Not signed in') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

interface RawUser {
  id: string;
  email: string;
  name?: string | null | undefined;
  image?: string | null | undefined;
  locale?: unknown;
}

/** The slice of `Auth` the helpers need, so this module stays independent of the server config. */
export interface SessionSource<S = unknown> {
  api: {
    getSession(args: { headers: Headers }): Promise<{ session: S; user: RawUser } | null>;
  };
}

export interface AuthSession<S = unknown> {
  session: S;
  user: SessionUser;
}

export function toSessionUser(user: RawUser): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name ? user.name : null,
    image: user.image ?? null,
    locale: toAuthLocale(user.locale),
  };
}

export function createSessionHelpers<S>({
  auth,
  headers,
}: {
  auth: SessionSource<S>;
  headers: () => Headers | Promise<Headers>;
}) {
  async function getSession(): Promise<AuthSession<S> | null> {
    const result = await auth.api.getSession({ headers: await headers() });
    if (!result) return null;
    return { session: result.session, user: toSessionUser(result.user) };
  }

  async function requireSession(): Promise<AuthSession<S>> {
    const result = await getSession();
    if (!result) throw new UnauthenticatedError();
    return result;
  }

  async function requireUser(): Promise<SessionUser> {
    return (await requireSession()).user;
  }

  return { getSession, requireSession, requireUser };
}
