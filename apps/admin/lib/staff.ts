// `requireStaff()` (#309): the second line of defence behind proxy.ts for server components and
// actions. It re-validates the session and the enabled staff_user row and returns the staff
// member's role, or answers with the generic not-found page.
import { db } from '@causedeck/core/runtime';
import { staffMember } from '@causedeck/core/support';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { sessionFor } from './auth.ts';
import { canStaff, isStaffRole, type StaffCapability, type StaffRole } from './roles.ts';

export interface StaffMember {
  userId: string;
  email: string;
  role: StaffRole;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/** The enabled staff role of `userId`, or `null`. `staff_user` is global, readable in any scope. */
export async function staffRoleOf(userId: string): Promise<StaffRole | null> {
  const row = await staffMember(db, userId);
  return row && isStaffRole(row.role) ? row.role : null;
}

/** The signed-in staff member; `notFound()` for anyone else, or when `capability` is not theirs. */
export async function requireStaff(capability?: StaffCapability): Promise<StaffMember> {
  const h = await headers();
  const current = await sessionFor(h).catch(() => null);
  if (!current) notFound();
  const role = await staffRoleOf(current.user.id);
  if (!role || (capability !== undefined && !canStaff(role, capability))) notFound();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined;
  const userAgent = h.get('user-agent') ?? undefined;
  const requestId = h.get('x-request-id') ?? undefined;
  return {
    userId: current.user.id,
    email: current.user.email,
    role,
    ...(ip ? { ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(requestId ? { requestId } : {}),
  };
}
