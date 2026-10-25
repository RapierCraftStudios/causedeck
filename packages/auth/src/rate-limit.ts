// Magic-link limits (#152): 20 per IP per hour is a Better Auth `customRules` entry; 5 per email per
// 15 minutes is ours, because Better Auth only keys limits by IP and path. The per-email counter
// lives in the same `rate_limit` table under a hashed key, so no plaintext address is stored.
import { createHash } from 'node:crypto';

import type { Database } from '@causedeck/db';
import { schema } from '@causedeck/db';
import { sql } from 'drizzle-orm';

export const MAGIC_LINK_EMAIL_LIMIT = { max: 5, windowSeconds: 15 * 60 } as const;
export const MAGIC_LINK_IP_LIMIT = { max: 20, windowSeconds: 60 * 60 } as const;

/** Same wording as Better Auth's own 429, so the two limits are indistinguishable. */
export const RATE_LIMIT_MESSAGE = 'Too many requests. Please try again later.';

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function magicLinkEmailKey(email: string): string {
  const digest = createHash('sha256').update(normaliseEmail(email)).digest('hex');
  return `magic-link:email:${digest}`;
}

/**
 * Count one request against `key` in a fixed window and report whether it is within `max`. One
 * atomic upsert, so concurrent requests cannot both read a stale count.
 */
export async function consumeRateLimit(
  db: Database,
  key: string,
  limit: { max: number; windowSeconds: number },
  now: number = Date.now(),
): Promise<boolean> {
  const { rateLimit } = schema;
  const windowStart = now - limit.windowSeconds * 1000;
  const expired = sql`${rateLimit.lastRequest} <= ${windowStart}`;
  const [row] = await db
    .insert(rateLimit)
    .values({ key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${expired} then ${now} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning({ count: rateLimit.count });
  return (row?.count ?? 1) <= limit.max;
}

/** Phone OTP limits (#503): sends per number per 15 minutes, and per IP per hour. */
export const PHONE_OTP_PHONE_LIMIT = { max: 5, windowSeconds: 15 * 60 } as const;
export const PHONE_OTP_IP_LIMIT = { max: 20, windowSeconds: 60 * 60 } as const;
/** Code checks per IP per hour; the per-code attempt cap is the plugin's `allowedAttempts`. */
export const PHONE_VERIFY_IP_LIMIT = { max: 30, windowSeconds: 60 * 60 } as const;

/** Hashed like the email key, so no plaintext number is stored in `rate_limit`. */
export function phoneOtpKey(phoneNumber: string): string {
  const digest = createHash('sha256').update(phoneNumber.replace(/\s+/g, '')).digest('hex');
  return `phone-otp:phone:${digest}`;
}
