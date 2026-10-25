// Platform staff accounts (#308, #309, part of #27): the global `staff_user` table. Apps never touch
// it through `@causedeck/db` (#299); the admin console reads it here, and the operator CLI
// (apps/admin `staff:*`) writes it here as the owner role, because the app role may only read
// `staff_user` (migration 0025). No app, API or UI path can create or change a staff account.
import { createDb, isUuid, schema, type Database, type Queryable } from '@causedeck/db';
import { and, count, eq, isNull, sql } from 'drizzle-orm';

import { endStaffSupportSessions } from './sessions.ts';

const { staffUser, user } = schema;

export const STAFF_ROLES = schema.STAFF_ROLES;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * The local dev staff account, created by `pnpm --filter @causedeck/admin staff:seed-dev`. Outside
 * production, and for this account only, the admin gate skips the IP allowlist and the 2FA step.
 */
export const DEV_STAFF_EMAIL = 'staff@causedeck.local';

/** A staff operation the operator can fix (unknown email, not staff); safe to print. */
export class StaffAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaffAdminError';
  }
}

export interface StaffMemberRow {
  userId: string;
  role: StaffRole;
}

/** The enabled staff row of `userId`, or `null`. `staff_user` is global, readable in any scope. */
export async function staffMember(db: Queryable, userId: string): Promise<StaffMemberRow | null> {
  if (!isUuid(userId)) return null;
  const [row] = await db
    .select({ userId: staffUser.userId, role: staffUser.role })
    .from(staffUser)
    .where(and(eq(staffUser.userId, userId), isNull(staffUser.disabledAt)))
    .limit(1);
  return row ?? null;
}

/** Enabled staff accounts (the admin Overview). */
export async function countActiveStaff(db: Queryable): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(staffUser)
    .where(isNull(staffUser.disabledAt));
  return row?.value ?? 0;
}

async function userIdFor(db: Database, email: string): Promise<string> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = lower(${email})`)
    .limit(1);
  if (row === undefined) {
    throw new StaffAdminError(`No user with that email. They must sign up before becoming staff.`);
  }
  return row.id;
}

export interface AddStaffResult {
  userId: string;
  role: StaffRole;
  /** True when a disabled staff row was re-enabled. */
  reenabled: boolean;
}

/** Make the user staff with `role` (re-enabling a disabled row). `db` must be the owner role. */
export async function addStaff(
  db: Database,
  { email, role, by }: { email: string; role: StaffRole; by?: string },
): Promise<AddStaffResult> {
  const userId = await userIdFor(db, email);
  const createdBy = by === undefined ? null : await userIdFor(db, by);
  const [existing] = await db
    .select({ disabledAt: staffUser.disabledAt })
    .from(staffUser)
    .where(eq(staffUser.userId, userId));
  await db
    .insert(staffUser)
    .values({ userId, role, createdBy })
    .onConflictDoUpdate({ target: staffUser.userId, set: { role, disabledAt: null } });
  return { userId, role, reenabled: existing?.disabledAt != null };
}

export interface DisableStaffResult {
  userId: string;
  /** Support sessions ended by the disable. */
  endedSessions: number;
}

/**
 * Disable a staff member and end their sessions immediately. `db` must be the owner role.
 * Idempotent: disabling again re-runs the session sweep.
 */
export async function disableStaff(
  db: Database,
  { email }: { email: string },
): Promise<DisableStaffResult> {
  const userId = await userIdFor(db, email);
  const [row] = await db
    .update(staffUser)
    .set({ disabledAt: sql`coalesce(${staffUser.disabledAt}, now())` })
    .where(eq(staffUser.userId, userId))
    .returning({ userId: staffUser.userId });
  if (row === undefined) throw new StaffAdminError('That user is not staff.');
  const endedSessions = await endStaffSupportSessions(db, userId);
  return { userId, endedSessions };
}

/**
 * Create (or re-enable) the local dev staff account, DEV_STAFF_EMAIL, as `admin`; idempotent.
 * `db` must be the owner role. The CLI refuses to call it in production.
 */
export async function seedDevStaff(db: Database): Promise<AddStaffResult> {
  await db
    .insert(user)
    .values({ email: DEV_STAFF_EMAIL, name: 'Dev staff', emailVerified: true })
    .onConflictDoNothing({ target: user.email });
  return addStaff(db, { email: DEV_STAFF_EMAIL, role: 'admin' });
}

/** Run `fn` on a single-connection owner-role handle for `url`, closing it afterwards. */
export async function withOwnerDb<T>(
  url: Parameters<typeof createDb>[0]['url'],
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const db = createDb({ url, role: 'owner', max: 1 });
  try {
    return await fn(db);
  } finally {
    await db.$client.end();
  }
}
