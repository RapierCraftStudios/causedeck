'use server';
// Flag changes from the staff console (#311). Every action re-checks the staff member and the
// `flags` capability (ops and admin), then writes through `@causedeck/flags`, which audits each
// change in the same transaction (lib/flags.ts installs the real writer). A legal-gated enable is
// two-person: anyone with `flags` requests it with a note, the acknowledgement and a fresh TOTP
// code; a different admin approves it, also with a fresh code.
import { db } from '@causedeck/core/runtime';
import {
  approveLegalEnable,
  asStaff,
  FlagAdminError,
  getFlag,
  isFlagKey,
  rejectLegalEnable,
  requestLegalEnable,
  setFlag,
  setWorkspaceFlag,
  type FlagAdminErrorCode,
} from '@causedeck/flags';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { reverifyTotp } from '../../../lib/flags.ts';
import { requireStaff } from '../../../lib/staff.ts';

export interface FlagActionState {
  error?: string;
  done?: string;
}

const ERRORS: Record<FlagAdminErrorCode, string> = {
  FORBIDDEN: 'You cannot make this change.',
  LEGAL_ACK_REQUIRED: 'Add the legal note before enabling this flag.',
  NOT_LEGAL_GATED: 'This flag is not legal-gated.',
  REQUEST_PENDING: 'This flag already has a request waiting for approval.',
  REQUEST_NOT_PENDING: 'That request is no longer pending.',
  SELF_APPROVAL: 'A second admin must approve your own request.',
};

const flagKey = z.string().refine(isFlagKey);
const workspaceId = z
  .union([z.literal(''), z.uuid()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? undefined : v));

const setSchema = z.object({
  key: flagKey,
  workspaceId,
  enabled: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

const requestSchema = z.object({
  key: flagKey,
  workspaceId,
  note: z.string().trim().min(1).max(2000),
  acknowledged: z.literal('on'),
});

const decisionSchema = z.object({ requestId: z.uuid() });

const fields = (formData: FormData, names: readonly string[]) =>
  Object.fromEntries(names.flatMap((n) => (formData.has(n) ? [[n, formData.get(n)]] : [])));

/** A foreign-key violation (raw or wrapped by Drizzle): here, a workspace id that does not exist. */
function isForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (code === '23503') return true;
    current = cause;
  }
  return false;
}

async function run(fn: () => Promise<unknown>, done: string): Promise<FlagActionState> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof FlagAdminError) return { error: ERRORS[error.code] };
    if (isForeignKeyViolation(error)) return { error: 'No workspace has that id.' };
    throw error;
  }
  revalidatePath('/flags');
  return { done };
}

/** Turn a flag on or off, globally or for one workspace. Not for enabling a legal-gated flag. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('flags')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function setFlagAction(
  _previous: FlagActionState,
  formData: FormData,
): Promise<FlagActionState> {
  const staff = await requireStaff('flags');
  const parsed = setSchema.safeParse(fields(formData, ['key', 'workspaceId', 'enabled']));
  if (!parsed.success) return { error: 'Could not read that change. Reload and try again.' };
  const { key, workspaceId: ws, enabled } = parsed.data;
  if (enabled && getFlag(key).legalGated) {
    return { error: 'Enabling a legal-gated flag needs a second admin: send a request instead.' };
  }
  const actor = asStaff(staff.userId);
  return run(
    () =>
      ws === undefined
        ? setFlag(db, actor, { key, enabled })
        : setWorkspaceFlag(db, actor, { workspaceId: ws, key, enabled }),
    `${key} is now ${enabled ? 'on' : 'off'}.`,
  );
}

/** Ask a second admin to enable a legal-gated flag: note, acknowledgement and a fresh TOTP code. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('flags')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function requestLegalEnableAction(
  _previous: FlagActionState,
  formData: FormData,
): Promise<FlagActionState> {
  const staff = await requireStaff('flags');
  const parsed = requestSchema.safeParse(
    fields(formData, ['key', 'workspaceId', 'note', 'acknowledged']),
  );
  if (!parsed.success) {
    return { error: 'Add the legal note and confirm the acknowledgement.' };
  }
  const totp = await reverifyTotp(staff, formData.get('code'));
  if (!totp.ok) return { error: totp.error };
  const { key, workspaceId: ws, note } = parsed.data;
  return run(
    () =>
      requestLegalEnable(db, asStaff(staff.userId), {
        key,
        workspaceId: ws,
        legalAckNote: note,
      }),
    `Request sent: ${key} turns on once a second admin approves it.`,
  );
}

/** Approve another staff member's request (admin role, fresh TOTP code). */
// authz: public to the product's policy (staff are not workspace members); requireStaff('flags')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function approveLegalEnableAction(
  _previous: FlagActionState,
  formData: FormData,
): Promise<FlagActionState> {
  const staff = await requireStaff('flags');
  if (staff.role !== 'admin') notFound();
  const parsed = decisionSchema.safeParse(fields(formData, ['requestId']));
  if (!parsed.success) return { error: 'Could not read that request. Reload and try again.' };
  const totp = await reverifyTotp(staff, formData.get('code'));
  if (!totp.ok) return { error: totp.error };
  return run(
    () => approveLegalEnable(db, asStaff(staff.userId), { requestId: parsed.data.requestId }),
    'Approved: the flag is on.',
  );
}

/** Reject a request (admin) or withdraw your own. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('flags')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function rejectLegalEnableAction(
  _previous: FlagActionState,
  formData: FormData,
): Promise<FlagActionState> {
  const staff = await requireStaff('flags');
  const parsed = decisionSchema.safeParse(fields(formData, ['requestId']));
  if (!parsed.success) return { error: 'Could not read that request. Reload and try again.' };
  return run(
    () => rejectLegalEnable(db, asStaff(staff.userId), { requestId: parsed.data.requestId }),
    'Request closed.',
  );
}
