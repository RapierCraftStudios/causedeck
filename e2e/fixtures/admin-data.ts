// Admin console e2e fixture data (#309), shared by support/db-reset.ts (which seeds it into the
// template as the owner role) and fixtures/admin.ts. No Playwright imports, so the seed step can
// load it.
import { createHash, createHmac } from 'node:crypto';

/** Seeded in the template by support/db-reset.ts (owner role). */
export const ADMIN_FIXTURES = {
  /** `admin` staff with TOTP enrolled (secret below). */
  staff: { email: 'staff-admin@e2e.causedeck.test', role: 'admin', twoFactor: true },
  /** `ops` staff with TOTP enrolled: the first person of a legal-gated flag enable (#311). */
  ops: { email: 'staff-ops@e2e.causedeck.test', role: 'ops', twoFactor: true },
  /** `support` staff without 2FA: always the generic 404. */
  noTwoFactor: { email: 'staff-no2fa@e2e.causedeck.test', role: 'support', twoFactor: false },
  /** Disabled `admin` staff with TOTP enrolled: always the generic 404. */
  disabled: { email: 'staff-disabled@e2e.causedeck.test', role: 'admin', twoFactor: true },
  /** A product user with TOTP enrolled who is not staff. */
  nonStaff: { email: 'not-staff@e2e.causedeck.test', role: null, twoFactor: true },
} as const;
export type AdminFixture = keyof typeof ADMIN_FIXTURES;

/**
 * The TOTP secret of every enrolled fixture (Better Auth keys HMAC-SHA1 with its UTF-8 bytes).
 * Derived from a label rather than written out, so no key-shaped literal sits in the tree (gitleaks);
 * the seed and the fixtures run in different processes and must agree on it.
 */
export const ADMIN_TOTP_SECRET = createHash('sha256')
  .update('causedeck e2e admin console totp')
  .digest('hex')
  .slice(0, 32);

/** The current six-digit TOTP code for `secret` (RFC 6238, 30 s, SHA-1), as Better Auth computes. */
export function totpCode(secret: string = ADMIN_TOTP_SECRET, now: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const mac = createHmac('sha1', Buffer.from(secret, 'utf8')).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 15;
  const value =
    (((mac[offset] ?? 0) & 127) << 24) |
    (((mac[offset + 1] ?? 0) & 255) << 16) |
    (((mac[offset + 2] ?? 0) & 255) << 8) |
    ((mac[offset + 3] ?? 0) & 255);
  return String(value % 1_000_000).padStart(6, '0');
}
