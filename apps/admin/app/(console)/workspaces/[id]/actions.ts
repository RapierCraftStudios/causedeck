'use server';
// Staff AI budget overrides for one workspace (#224). Admin staff only (`canOverrideBudget`): set
// a new override, or end an active one early, each with a reason. The core services validate again
// and audit every change (`usage.budget_override_set` / `usage.budget_override_expired`, actor kind
// `staff`) in the same transaction as the write.
import { db } from '@causedeck/core/runtime';
import { expireBudgetOverride, setBudgetOverride } from '@causedeck/core/usage';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { canOverrideBudget } from '../../../../lib/roles.ts';
import { requireStaff, type StaffMember } from '../../../../lib/staff.ts';

export interface OverrideFormState {
  error?: string;
  done?: boolean;
}

const MAX_REASON = 500;

const reason = z
  .string()
  .trim()
  .min(1, 'Give a reason.')
  .max(MAX_REASON, `Keep the reason under ${String(MAX_REASON)} characters.`);

/** Rupees with at most two decimals, e.g. `175` or `1250.50`. */
const RUPEES = /^\d{1,9}(\.\d{1,2})?$/;

/** `Rs 12.34` as integer paise, without floating-point rounding. */
function rupeesToPaise(value: string): number | null {
  const text = value.trim();
  if (!RUPEES.test(text)) return null;
  const [whole = '0', fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** A `datetime-local` value (`2026-11-01T09:30`) read as UTC, like every time the console shows. */
function parseUtc(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const date = new Date(`${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const setSchema = z.object({
  workspaceId: z.uuid(),
  limitRupees: z.string(),
  expiresAt: z.string(),
  reason,
});

const expireSchema = z.object({ workspaceId: z.uuid(), overrideId: z.uuid(), reason });

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

async function overrideStaff(): Promise<StaffMember> {
  const staff = await requireStaff('workspaces');
  if (!canOverrideBudget(staff.role)) notFound();
  return staff;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.path[0] === 'reason' ? issue.message : 'Check the form and try again.';
}

// authz: public console action; it authorizes with requireStaff('workspaces') and admin-only
// canOverrideBudget below (the require-authorization lint knows only workspace guards).
export async function setBudgetOverrideAction(
  _previous: OverrideFormState,
  formData: FormData,
): Promise<OverrideFormState> {
  const staff = await overrideStaff();
  const parsed = setSchema.safeParse({
    workspaceId: field(formData, 'workspaceId'),
    limitRupees: field(formData, 'limitRupees'),
    expiresAt: field(formData, 'expiresAt'),
    reason: field(formData, 'reason'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const limitPaise = rupeesToPaise(parsed.data.limitRupees);
  if (limitPaise === null) return { error: 'Enter the limit in rupees, e.g. 175 or 1250.50.' };
  const expiresAt = parseUtc(parsed.data.expiresAt);
  if (expiresAt === null || expiresAt.getTime() <= Date.now()) {
    return { error: 'Choose an expiry in the future (UTC).' };
  }
  const { workspaceId } = parsed.data;
  try {
    await setBudgetOverride(
      { db, workspaceId },
      {
        limitPaise,
        reason: parsed.data.reason,
        expiresAt,
        staffUserId: staff.userId,
        ...(staff.requestId === undefined ? {} : { requestId: staff.requestId }),
      },
    );
  } catch (error) {
    if (error instanceof TypeError) return { error: 'The override was not saved. Check the form.' };
    throw error;
  }
  revalidatePath(`/workspaces/${workspaceId}`);
  return { done: true };
}

// authz: public console action; it authorizes with requireStaff('workspaces') and admin-only
// canOverrideBudget below (the require-authorization lint knows only workspace guards).
export async function expireBudgetOverrideAction(
  _previous: OverrideFormState,
  formData: FormData,
): Promise<OverrideFormState> {
  const staff = await overrideStaff();
  const parsed = expireSchema.safeParse({
    workspaceId: field(formData, 'workspaceId'),
    overrideId: field(formData, 'overrideId'),
    reason: field(formData, 'reason'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { workspaceId, overrideId } = parsed.data;
  try {
    await expireBudgetOverride(
      { db, workspaceId },
      {
        overrideId,
        reason: parsed.data.reason,
        staffUserId: staff.userId,
        ...(staff.requestId === undefined ? {} : { requestId: staff.requestId }),
      },
    );
  } catch (error) {
    if (error instanceof TypeError) return { error: 'This override is no longer active.' };
    throw error;
  }
  revalidatePath(`/workspaces/${workspaceId}`);
  return { done: true };
}
