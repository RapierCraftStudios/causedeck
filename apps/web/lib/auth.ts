// Server-only Better Auth wiring for apps/web (#153). Never import from a client component: it
// pulls in the database, the mailer and server secrets. `auth` is built on first use rather than at
// import, so `next build` (which evaluates route modules) never needs runtime secrets.
import { createMailer } from '@causedeck/auth/mailer';
import { createAuth, type Auth } from '@causedeck/auth/server';
import { createSessionHelpers } from '@causedeck/auth/session';
import { createSecurityEventRecorder } from '@causedeck/core/audit';
import { db } from '@causedeck/core/runtime';
import { headers } from 'next/headers';

import { logger } from '../src/health.ts';

import { serverEnv } from './env.ts';

let instance: Auth | undefined;

/** The app's Better Auth instance, created once per process. */
export function getAuth(): Auth {
  if (!instance) {
    const env = serverEnv();
    instance = createAuth({
      db,
      env,
      mailer: createMailer(env, logger),
      logger,
      securityEvents: createSecurityEventRecorder(db),
    });
  }
  return instance;
}

export const { getSession, requireSession, requireUser } = createSessionHelpers({
  auth: { api: { getSession: (args) => getAuth().api.getSession(args) } },
  headers,
  // The owner 2FA policy (#290) reads `twoFactorEnabled` from the session user.
  withTwoFactor: true,
});

export type AppSession = NonNullable<Awaited<ReturnType<typeof getSession>>>;
