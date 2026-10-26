'use server';
// The admin TOTP step (#309). proxy.ts lets only enabled staff with 2FA enrolled reach this; the
// action checks the same again, rate-limits attempts per user, asks Better Auth to verify the code
// for the current session, audits the success and sets the per-session `cd_admin_2fa` cookie.
import { consumeRateLimit } from '@causedeck/auth/rate-limit';
import { record } from '@causedeck/core/audit';
import { db } from '@causedeck/core/runtime';
import { isActiveStaff } from '@causedeck/core/support';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { getAuth, sessionFor } from '../../lib/auth.ts';
import { adminEnv } from '../../lib/env.ts';
import { clientIp } from '../../lib/ip-allowlist.ts';
import {
  ADMIN_TWO_FACTOR_COOKIE,
  normaliseTotpCode,
  signTwoFactorCookie,
  STAFF_TOTP_LIMIT,
  staffTotpRateLimitKey,
  twoFactorCookieOptions,
} from '../../lib/two-factor.ts';

export interface VerifyTwoFactorState {
  error?: string;
}

// authz: public pre-console step; it authorizes by the validated session, an enabled staff_user
// row and enrolled 2FA below (the console's own requireStaff needs the cookie this sets).
export async function verifyTwoFactor(
  _previous: VerifyTwoFactorState,
  formData: FormData,
): Promise<VerifyTwoFactorState> {
  const h = await headers();
  const current = await sessionFor(h).catch(() => null);
  if (
    !current ||
    current.user.twoFactorEnabled !== true ||
    !(await isActiveStaff(db, current.user.id))
  ) {
    notFound();
  }
  const code = normaliseTotpCode(formData.get('code'));
  if (code === null) return { error: 'Enter the 6-digit code from your authenticator app.' };
  if (!(await consumeRateLimit(db, staffTotpRateLimitKey(current.user.id), STAFF_TOTP_LIMIT))) {
    return { error: 'Too many attempts. Try again in 15 minutes.' };
  }
  try {
    await getAuth().api.verifyTOTP({ body: { code }, headers: h });
  } catch {
    return { error: 'That code did not work. Try again.' };
  }

  const env = adminEnv();
  const ip = clientIp(h);
  const userAgent = h.get('user-agent') ?? undefined;
  await record(
    {
      db,
      workspaceId: null,
      actor: { userId: current.user.id, kind: 'staff' },
      ...(ip === undefined ? {} : { ip }),
      ...(userAgent === undefined ? {} : { userAgent }),
    },
    {
      action: 'staff.two_factor_verified',
      target: { kind: 'session', id: current.session.id },
    },
  );
  (await cookies()).set(
    ADMIN_TWO_FACTOR_COOKIE,
    signTwoFactorCookie(env.BETTER_AUTH_SECRET.reveal(), current.session.id, Date.now()),
    twoFactorCookieOptions(env.NODE_ENV === 'production'),
  );
  redirect('/');
}
