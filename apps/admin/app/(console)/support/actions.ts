'use server';
// Staff support-session actions (#314, part of #27; spike §6). A staff member asks a workspace for
// a session with a reason, and may end (or withdraw) their own session at once. Both re-run
// `requireStaff('support')`; core then enforces the rest: only enabled staff can request, every
// owner is notified (`security.alert`, in-app and email), and only the requesting staff member (or
// the workspace owner) can end a session, audited as `support.session_ended` once it was granted.
import {
  requestSupportSessionFor,
  revokeSupportSessionFor,
  staffSupportSessionFor,
} from '@causedeck/core/runtime';
import { SUPPORT_REASON_MAX_LENGTH } from '@causedeck/core/support';
import { WorkspaceError } from '@causedeck/core/workspaces';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

import { requireStaff, type StaffMember } from '../../../lib/staff.ts';

export interface RequestSupportSessionState {
  error?: string;
  /** Field values to keep in the form after an error. */
  values?: { workspaceId: string; reason: string; scope: 'view' | 'metadata' };
}

const REQUEST = z.object({
  workspaceId: z.uuid(),
  reason: z.string().trim().min(1).max(SUPPORT_REASON_MAX_LENGTH),
  scope: z.enum(['view', 'metadata']).default('view'),
});

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

function staffContext(staff: StaffMember) {
  return {
    staffUserId: staff.userId,
    ...(staff.ip === undefined ? {} : { ip: staff.ip }),
    ...(staff.userAgent === undefined ? {} : { userAgent: staff.userAgent }),
    ...(staff.requestId === undefined ? {} : { requestId: staff.requestId }),
  };
}

// authz: public staff-console action: requireStaff('support') authorizes the staff member (session,
// enabled staff_user row, 2FA), and core requestSession refuses anyone who is not active staff.
export async function requestSupportSessionAction(
  _previous: RequestSupportSessionState,
  formData: FormData,
): Promise<RequestSupportSessionState> {
  const staff = await requireStaff('support');
  const scopeValue = field(formData, 'scope');
  const values = {
    workspaceId: field(formData, 'workspaceId').trim(),
    reason: field(formData, 'reason'),
    scope: scopeValue === 'metadata' ? ('metadata' as const) : ('view' as const),
  };
  const parsed = REQUEST.safeParse({
    ...values,
    scope: scopeValue === '' ? undefined : scopeValue,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.path[0];
    const error =
      issue === 'workspaceId'
        ? 'Enter the workspace ID (a UUID).'
        : issue === 'reason'
          ? `A reason is required (at most ${String(SUPPORT_REASON_MAX_LENGTH)} characters).`
          : 'Choose what support may see.';
    return { error, values };
  }
  let sessionId: string;
  try {
    const session = await requestSupportSessionFor(staffContext(staff), parsed.data);
    sessionId = session.id;
  } catch (error) {
    if (error instanceof WorkspaceError) {
      if (error.code === 'NOT_FOUND') return { error: 'Workspace not found.', values };
      if (error.code === 'VALIDATION') {
        return { error: 'A reason is required.', values };
      }
      if (error.code === 'FORBIDDEN') {
        return { error: 'Your staff account cannot request support sessions.', values };
      }
    }
    throw error;
  }
  revalidatePath('/support');
  redirect(`/support/${sessionId}`);
}

// authz: public staff-console action: requireStaff('support') authorizes the staff member, the
// session must be their own (staffSupportSessionFor), and core revokeSession re-checks that.
export async function endSupportSessionAction(formData: FormData): Promise<void> {
  const staff = await requireStaff('support');
  const sessionId = field(formData, 'sessionId');
  const session = await staffSupportSessionFor(staff.userId, sessionId);
  if (session === null) notFound();
  try {
    await revokeSupportSessionFor(
      {
        userId: staff.userId,
        workspaceId: session.workspaceId,
        ...(staff.ip === undefined ? {} : { ip: staff.ip }),
        ...(staff.userAgent === undefined ? {} : { userAgent: staff.userAgent }),
        ...(staff.requestId === undefined ? {} : { requestId: staff.requestId }),
      },
      { sessionId: session.id },
    );
  } catch (error) {
    // Already ended, denied or expired elsewhere: the session is over either way.
    if (!(error instanceof WorkspaceError && error.code === 'CONFLICT')) throw error;
  }
  revalidatePath('/support');
  revalidatePath(`/support/${session.id}`);
}
