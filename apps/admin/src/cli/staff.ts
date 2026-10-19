// Operator CLI for platform staff (#308, part of #27). Staff accounts exist only through this CLI:
//   pnpm --filter @causedeck/admin staff:add <email> --role support|ops|admin [--by <email>]
//   pnpm --filter @causedeck/admin staff:disable <email>
// It connects as the owner role (DATABASE_URL_OWNER), because the app role may only read
// `staff_user` (migration 0024): no app, API or UI path can create or change a staff account. The
// user must already exist (signed up through the product). Disabling a staff member ends every
// pending or granted support session of theirs at once, auditing each granted one.
import { pathToFileURL } from 'node:url';

import { createEnv } from '@causedeck/config/env';
import { endStaffSupportSessions } from '@causedeck/core/support';
import { createDb, schema, type Database } from '@causedeck/db';
import { eq, sql } from 'drizzle-orm';

const { staffUser, user } = schema;

export const STAFF_ROLES = schema.STAFF_ROLES;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const USAGE = [
  'Usage:',
  '  staff:add <email> --role support|ops|admin [--by <operator-staff-email>]',
  '  staff:disable <email>',
].join('\n');

export type StaffCommand =
  | { command: 'add'; email: string; role: StaffRole; by?: string }
  | { command: 'disable'; email: string };

export class StaffCliError extends Error {
  /** 1: the operation failed; 2: bad usage. */
  readonly exitCode: 1 | 2;

  constructor(message: string, exitCode: 1 | 2 = 1) {
    super(message);
    this.name = 'StaffCliError';
    this.exitCode = exitCode;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+$/;

function isStaffRole(value: string | undefined): value is StaffRole {
  return value !== undefined && (STAFF_ROLES as readonly string[]).includes(value);
}

function flag(args: string[], name: string): string | undefined {
  const at = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (at === -1) return undefined;
  const arg = args[at] ?? '';
  return arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[at + 1];
}

/** Parse `<add|disable> <email> [--role r] [--by email]`; throws `StaffCliError` (exit 2). */
export function parseStaffArgs(argv: readonly string[]): StaffCommand {
  const args = argv.filter((a) => a !== '--');
  const [command, email] = args;
  if (email === undefined || !EMAIL.test(email)) {
    throw new StaffCliError(`An email address is required.\n${USAGE}`, 2);
  }
  if (command === 'disable') return { command, email };
  if (command !== 'add') throw new StaffCliError(USAGE, 2);
  const role = flag(args, '--role');
  if (!isStaffRole(role)) {
    throw new StaffCliError(`--role must be one of ${STAFF_ROLES.join(', ')}.\n${USAGE}`, 2);
  }
  const by = flag(args, '--by');
  if (by !== undefined && !EMAIL.test(by)) throw new StaffCliError(`--by needs an email.`, 2);
  return by === undefined ? { command, email, role } : { command, email, role, by };
}

async function userIdFor(db: Database, email: string): Promise<string> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = lower(${email})`)
    .limit(1);
  if (row === undefined) {
    throw new StaffCliError(`No user with that email. They must sign up before becoming staff.`);
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
  if (row === undefined) throw new StaffCliError('That user is not staff.');
  const endedSessions = await endStaffSupportSessions(db, userId);
  return { userId, endedSessions };
}

/** Run one CLI invocation; returns the process exit code. */
export async function runStaffCli(
  argv: readonly string[],
  out: (line: string) => void = console.log,
  err: (line: string) => void = console.error,
): Promise<number> {
  let parsed: StaffCommand;
  try {
    parsed = parseStaffArgs(argv);
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return error instanceof StaffCliError ? error.exitCode : 1;
  }
  const url = createEnv().DATABASE_URL_OWNER;
  if (url === undefined) {
    err('DATABASE_URL_OWNER is not set: staff are managed by an operator as the owner role.');
    return 1;
  }
  const db = createDb({ url, role: 'owner', max: 1 });
  try {
    if (parsed.command === 'add') {
      const added = await addStaff(db, parsed);
      out(`${added.reenabled ? 'Re-enabled' : 'Added'} staff ${parsed.email} (${added.role}).`);
    } else {
      const disabled = await disableStaff(db, parsed);
      out(
        `Disabled staff ${parsed.email}; ended ${String(disabled.endedSessions)} support session(s).`,
      );
    }
    return 0;
  } catch (error) {
    // Never echo driver errors: they can carry connection details.
    err(error instanceof StaffCliError ? error.message : 'Staff command failed.');
    return error instanceof StaffCliError ? error.exitCode : 1;
  } finally {
    await db.$client.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exitCode = await runStaffCli(process.argv.slice(2));
}
