'use server';
// Members page server actions (#181). Each one goes through `workspaceAction`
// (lib/workspace-action.ts): zod input, `requireSession`, then the caller's membership, with
// non-members rejected as FORBIDDEN before the handler runs, and each action's policy permission
// (`member.invite`, `member.role`, `member.remove`; #234) asserted by `guard`. The handlers call the
// domain service (`@causedeck/core/workspaces`) on the workspace-scoped transaction `ctx.tx`, which
// checks the same policy again (which roles an inviter may grant, the last-owner rule).
//
// Invitation emails go through the auth `Mailer` (`createMailer`): the console transport in dev and
// CI, Mailpit with EMAIL_PROVIDER=smtp. The plaintext invite link comes back to the client only for
// the dev "Copy link" toast, never in production or with the SES transport (#23).
import type { WorkspaceRole } from '@causedeck/core/workspaces';
import { ChangeRoleInput, INVITE_ROLE_VALUES } from '@causedeck/validators/workspace';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

/** At most this many addresses per `Send invitation`; the invite rate limit still applies. */
const MAX_INVITES_PER_SEND = 20;

const InviteMembers = WorkspaceScoped.extend({
  emails: z
    .array(z.email().transform((value) => value.toLowerCase()))
    .min(1)
    .max(MAX_INVITES_PER_SEND),
  role: z.enum(INVITE_ROLE_VALUES),
  note: z.string().trim().max(500).optional(),
});

const ChangeRole = WorkspaceScoped.extend(ChangeRoleInput.shape);
const MemberTarget = WorkspaceScoped.extend({ memberId: z.uuid() });
const RemoveMember = MemberTarget.extend({ reassignTo: z.uuid().optional() });
const InvitationTarget = WorkspaceScoped.extend({ invitationId: z.uuid() });
const TransferTarget = WorkspaceScoped.extend({ newOwnerUserId: z.uuid() });
const ConfirmTransfer = TransferTarget.extend({ confirmation: z.string().trim().min(1) });

/** Why one address in a batch was not invited; the dialog shows a translated line per reason. */
export type InviteFailure = 'forbidden' | 'rateLimited' | 'invalid' | 'conflict' | 'failed';

export type InviteOutcome =
  | { email: string; status: 'sent'; /** Dev/console mailer only. */ link?: string }
  | { email: string; status: InviteFailure }
  /** The plan has no seat left for the role (#203); `seats` is the plan's seat count. */
  | { email: string; status: 'seatLimit'; seats: number };

export interface OpenWork {
  /** Open tasks and obligations the member holds; removal needs a reassignment when above 0. */
  count: number;
}

export interface TransferPlan {
  /** Echo back to confirm (the workspace slug). */
  confirmation: string;
  newOwner: { userId: string; name: string; email: string };
}

const FAILURE_BY_CODE: Record<string, InviteFailure> = {
  FORBIDDEN: 'forbidden',
  RATE_LIMITED: 'rateLimited',
  VALIDATION: 'invalid',
  CONFLICT: 'conflict',
};

function inviteFailure(error: unknown): InviteFailure {
  if (error instanceof Error && error.name === 'WorkspaceError' && 'code' in error) {
    return FAILURE_BY_CODE[String(error.code)] ?? 'failed';
  }
  return 'failed';
}

/** The billing seat gate's `ENTITLEMENT_EXCEEDED`, matched by shape like `inviteFailure`. */
function seatLimit(error: unknown): number | null {
  if (!(error instanceof Error) || error.name !== 'EntitlementError') return null;
  const { code, limit } = error as Error & { code?: unknown; limit?: unknown };
  return code === 'ENTITLEMENT_EXCEEDED' && typeof limit === 'number' ? limit : null;
}

async function mailSettings() {
  const [{ createMailer }, { toAuthLocale }, { getLocale }, env, { logger }] = await Promise.all([
    import('@causedeck/auth/mailer'),
    import('@causedeck/auth/messages'),
    import('next-intl/server'),
    import('../../../../../../lib/env.ts'),
    import('../../../../../../src/health.ts'),
  ]);
  const server = env.serverEnv();
  return {
    mailer: createMailer(server, logger),
    appUrl: server.APP_URL,
    locale: toAuthLocale(await getLocale()),
    /** Only outside production and never with SES: the link is otherwise only in the email. */
    exposeLink: !env.isProd() && server.EMAIL_PROVIDER !== 'ses',
  };
}

const core = () => import('@causedeck/core/workspaces');

/** The workspaces service with the billing seat gate (#203) installed. */
async function gatedCore() {
  const [workspaces, { installBillingEntitlements }] = await Promise.all([
    core(),
    import('@causedeck/core/billing'),
  ]);
  installBillingEntitlements();
  return workspaces;
}

function refresh(): void {
  revalidatePath('/w/[slug]/settings/members', 'page');
}

const invite = workspaceAction(
  InviteMembers,
  async (input, ctx) => {
    const [{ inviteMember }, mail] = await Promise.all([gatedCore(), mailSettings()]);
    const results: InviteOutcome[] = [];
    for (const email of new Set(input.emails)) {
      try {
        const issued = await inviteMember(ctx.tx, {
          workspaceId: ctx.workspaceId,
          actorUserId: ctx.userId,
          input: { email, role: input.role },
          mailer: mail.mailer,
          appUrl: mail.appUrl,
          locale: mail.locale,
        });
        results.push(
          mail.exposeLink
            ? {
                email,
                status: 'sent',
                link: new URL(`/invite/${issued.token}`, mail.appUrl).toString(),
              }
            : { email, status: 'sent' },
        );
      } catch (error) {
        const seats = seatLimit(error);
        results.push(
          seats === null
            ? { email, status: inviteFailure(error) }
            : { email, status: 'seatLimit', seats },
        );
      }
    }
    refresh();
    return { results };
  },
  { action: 'member.invite' },
);

const changeMemberRole = workspaceAction(
  ChangeRole,
  async (input, ctx) => {
    const { changeRole } = await core();
    await changeRole(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      memberId: input.memberId,
      role: input.role,
    });
    refresh();
    return { memberId: input.memberId, role: input.role };
  },
  { action: 'member.role' },
);

const openWork = workspaceAction(
  MemberTarget,
  async (input, ctx) => {
    const { countOpenWork, listMembers } = await core();
    const target = (await listMembers(ctx.tx, ctx.workspaceId)).find(
      (m) => m.memberId === input.memberId,
    );
    const count = target ? await countOpenWork(ctx.tx, ctx.workspaceId, target.userId) : 0;
    return { count } satisfies OpenWork;
  },
  { action: 'member.remove' },
);

const remove = workspaceAction(
  RemoveMember,
  async (input, ctx) => {
    const { removeMember } = await core();
    await removeMember(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      memberId: input.memberId,
      reassignTo: input.reassignTo,
    });
    refresh();
    return { memberId: input.memberId };
  },
  { action: 'member.remove' },
);

const resend = workspaceAction(
  InvitationTarget,
  async (input, ctx) => {
    const [{ reissueInvitation }, mail] = await Promise.all([core(), mailSettings()]);
    const issued = await reissueInvitation(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      invitationId: input.invitationId,
      mailer: mail.mailer,
      appUrl: mail.appUrl,
      locale: mail.locale,
    });
    refresh();
    const { email } = issued.invitation;
    return mail.exposeLink
      ? { email, link: new URL(`/invite/${issued.token}`, mail.appUrl).toString() }
      : { email };
  },
  { action: 'member.invite' },
);

const revoke = workspaceAction(
  InvitationTarget,
  async (input, ctx) => {
    const { revokeInvitation } = await core();
    await revokeInvitation(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      invitationId: input.invitationId,
    });
    refresh();
    return { invitationId: input.invitationId };
  },
  { action: 'member.invite' },
);

const prepareTransfer = workspaceAction(
  TransferTarget,
  async (input, ctx) => {
    const { prepareOwnershipTransfer } = await core();
    const plan = await prepareOwnershipTransfer(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      newOwnerUserId: input.newOwnerUserId,
    });
    const { userId, name, email } = plan.newOwner;
    return { confirmation: plan.confirmation, newOwner: { userId, name, email } };
  },
  { action: 'member.role' },
);

const confirmTransfer = workspaceAction(
  ConfirmTransfer,
  async (input, ctx) => {
    const { transferOwnership } = await core();
    await transferOwnership(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      newOwnerUserId: input.newOwnerUserId,
      confirmation: input.confirmation,
    });
    refresh();
    return { newOwnerUserId: input.newOwnerUserId };
  },
  { action: 'member.role' },
);

// A `'use server'` module may only export async functions, so each action is wrapped.

export async function inviteMembersAction(
  raw: unknown,
): Promise<Result<{ results: InviteOutcome[] }>> {
  return invite(raw);
}

export async function changeRoleAction(
  raw: unknown,
): Promise<Result<{ memberId: string; role: WorkspaceRole }>> {
  return changeMemberRole(raw);
}

export async function openWorkAction(raw: unknown): Promise<Result<OpenWork>> {
  return openWork(raw);
}

export async function removeMemberAction(raw: unknown): Promise<Result<{ memberId: string }>> {
  return remove(raw);
}

export async function resendInvitationAction(
  raw: unknown,
): Promise<Result<{ email: string; link?: string }>> {
  return resend(raw);
}

export async function revokeInvitationAction(
  raw: unknown,
): Promise<Result<{ invitationId: string }>> {
  return revoke(raw);
}

export async function prepareTransferAction(raw: unknown): Promise<Result<TransferPlan>> {
  return prepareTransfer(raw);
}

export async function confirmTransferAction(
  raw: unknown,
): Promise<Result<{ newOwnerUserId: string }>> {
  return confirmTransfer(raw);
}
