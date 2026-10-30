// Server-only Better Auth wiring for apps/admin (#309), mirroring apps/web/lib/auth.ts. The admin
// instance runs on the admin origin with 8 h sessions and closed sign-up: staff accounts are
// existing product users promoted by the operator CLI, never created here. Built on first use, so
// `next build` never needs runtime secrets.
import { createMailer } from '@causedeck/auth/mailer';
import { createAuth, type Auth } from '@causedeck/auth/server';
import { createSecurityEventRecorder } from '@causedeck/core/audit';
import { authDb, db } from '@causedeck/core/runtime';

import { adminEnv } from './env.ts';
import { logger } from './health.ts';
import { STAFF_SESSION_SECONDS } from './roles.ts';

let instance: Auth | undefined;

/** The admin console's Better Auth instance, created once per process. */
export function getAuth(): Auth {
  if (!instance) {
    const env = adminEnv();
    instance = createAuth({
      db,
      // Session lookups get their own small pool (#805).
      sessionDb: authDb,
      env: { ...env, APP_URL: env.ADMIN_URL },
      mailer: createMailer(env, logger),
      logger,
      securityEvents: createSecurityEventRecorder(db),
      sessionExpiresInSeconds: STAFF_SESSION_SECONDS,
      disableSignUp: true,
    });
  }
  return instance;
}

export interface AdminSession {
  session: { id: string };
  user: { id: string; email: string; twoFactorEnabled?: boolean | null | undefined };
}

/** The session for `headers`, validated against the database, or `null`. */
export async function sessionFor(headers: Headers): Promise<AdminSession | null> {
  const result = await getAuth().api.getSession({ headers });
  if (!result) return null;
  const user = result.user as { id: string; email: string; twoFactorEnabled?: boolean | null };
  return {
    session: { id: result.session.id },
    user: { id: user.id, email: user.email, twoFactorEnabled: user.twoFactorEnabled ?? null },
  };
}
