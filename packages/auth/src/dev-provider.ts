// Dev/test-only sign-in by email (#152, used by the #16 e2e harness). Never part of a production
// build: `createAuth` registers it only behind a literal `process.env.NODE_ENV` check that bundlers
// fold away, and the endpoint itself answers 404 if it is ever reached in production.
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

export const DEV_SIGN_IN_PATH = '/dev/sign-in';

const bodySchema = z.object({ email: z.email(), name: z.string().optional() });

export function devSignIn() {
  return {
    id: 'dev-sign-in',
    endpoints: {
      devSignIn: createAuthEndpoint(
        DEV_SIGN_IN_PATH,
        { method: 'POST', body: bodySchema },
        async (ctx) => {
          // eslint-disable-next-line no-process-env -- runtime guard; set by the host, not app config.
          if (process.env.NODE_ENV === 'production') throw new APIError('NOT_FOUND');
          const email = ctx.body.email.trim().toLowerCase();
          const { internalAdapter } = ctx.context;
          const existing = await internalAdapter.findUserByEmail(email);
          const user =
            existing?.user ??
            (await internalAdapter.createUser(
              {
                email,
                name: ctx.body.name ?? '',
                emailVerified: true,
              },
              { method: 'dev-sign-in' },
            ));
          const session = await internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ user: { id: user.id, email: user.email } });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
