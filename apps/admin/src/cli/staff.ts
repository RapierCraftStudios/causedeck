// Operator CLI for platform staff (#308, part of #27). Staff accounts exist only through this CLI:
//   pnpm --filter @causedeck/admin staff:add <email> --role support|ops|admin [--by <email>]
//   pnpm --filter @causedeck/admin staff:disable <email>
//   pnpm --filter @causedeck/admin staff:seed-dev            (never in production, #309)
// It connects as the owner role (DATABASE_URL_OWNER), because the app role may only read
// `staff_user` (migration 0025): no app, API or UI path can create or change a staff account. The
// user must already exist (signed up through the product). Disabling a staff member ends every
// pending or granted support session of theirs at once, auditing each granted one.
import { pathToFileURL } from 'node:url';

import { createEnv } from '@causedeck/config/env';
import {
  addStaff,
  DEV_STAFF_EMAIL,
  disableStaff,
  seedDevStaff,
  StaffAdminError,
  STAFF_ROLES,
  withOwnerDb,
  type StaffRole,
} from '@causedeck/core/support';

// The table work lives in `@causedeck/core/support` (apps never value-import `@causedeck/db`, #299).
export {
  addStaff,
  disableStaff,
  seedDevStaff,
  STAFF_ROLES,
  type AddStaffResult,
  type DisableStaffResult,
  type StaffRole,
} from '@causedeck/core/support';

export const USAGE = [
  'Usage:',
  '  staff:add <email> --role support|ops|admin [--by <operator-staff-email>]',
  '  staff:disable <email>',
  '  staff:seed-dev',
].join('\n');

export type StaffCommand =
  | { command: 'add'; email: string; role: StaffRole; by?: string }
  | { command: 'disable'; email: string }
  | { command: 'seed-dev' };

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
  if (command === 'seed-dev') {
    if (email !== undefined) throw new StaffCliError(`seed-dev takes no arguments.\n${USAGE}`, 2);
    return { command };
  }
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
  const env = createEnv();
  if (parsed.command === 'seed-dev' && env.NODE_ENV === 'production') {
    err('staff:seed-dev is for local development only; it refuses to run in production.');
    return 1;
  }
  const url = env.DATABASE_URL_OWNER;
  if (url === undefined) {
    err('DATABASE_URL_OWNER is not set: staff are managed by an operator as the owner role.');
    return 1;
  }
  try {
    await withOwnerDb(url, async (db) => {
      if (parsed.command === 'add') {
        const added = await addStaff(db, parsed);
        out(`${added.reenabled ? 'Re-enabled' : 'Added'} staff ${parsed.email} (${added.role}).`);
      } else if (parsed.command === 'seed-dev') {
        await seedDevStaff(db);
        out(`Dev staff ${DEV_STAFF_EMAIL} (admin) is ready. Sign in with the dev sign-in.`);
      } else {
        const disabled = await disableStaff(db, parsed);
        out(
          `Disabled staff ${parsed.email}; ended ${String(disabled.endedSessions)} support session(s).`,
        );
      }
    });
    return 0;
  } catch (error) {
    // Never echo driver errors: they can carry connection details.
    const known = error instanceof StaffCliError || error instanceof StaffAdminError;
    err(known ? error.message : 'Staff command failed.');
    return error instanceof StaffCliError ? error.exitCode : 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exitCode = await runStaffCli(process.argv.slice(2));
}
