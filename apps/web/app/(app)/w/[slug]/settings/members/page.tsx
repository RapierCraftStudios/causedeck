// `/w/[slug]/settings/members` (#181): who is in the workspace, with what role, and pending
// invitations. Every member may look; what they may change is decided per role in the client view
// and enforced again by the domain service behind each server action. It renders inside the
// settings shell (#284), whose banner covers the offline state. #288 adds the seat summary, the
// members / pending invitations tabs and the roles explainer below 1280; `?transfer=1` (the danger
// zone's `Transfer ownership`) opens the transfer picker for an owner. The header links to the
// roles page (`How roles work`, #285) for roles that can open it; advocates see no invite button
// while the workspace turns `advocatesCanInvite` off.
//
// States: loading (six skeleton rows while the list streams in), error (`Could not load members.`
// with `Try again`), empty (only the caller; no pending invitations), offline (read-only, the
// settings banner) and permission-denied (in the client view). If only the seat read fails, the
// list still renders without the seat card. `?__state=loading|error` previews the first two in
// development, like the shell.
import type { PolicySettings } from '@causedeck/auth/policy';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { isDev } from '../../../../../../lib/env.ts';
import { canOpenSettings, settingsHref } from '../../../../../../lib/settings-nav.ts';
import type { Role, WorkspaceContext } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../src/health.ts';

import {
  changeRoleAction,
  confirmTransferAction,
  inviteMembersAction,
  openWorkAction,
  prepareTransferAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
} from './actions.ts';
import {
  MembersError,
  MembersSkeleton,
  MembersView,
  type InvitationRow,
  type MemberRow,
  type SeatSummary,
} from './members-table.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface MembersPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

const ROLES: readonly string[] = [
  'owner',
  'advocate',
  'junior',
  'clerk',
  'viewer',
] satisfies Role[];

function isRole(value: string): value is Role {
  return ROLES.includes(value);
}

/** `?__state=loading|error` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('members');
  return { title: t('metaTitle') };
}

/** `?transfer=1`: open the ownership transfer picker (the danger zone's entry point). */
function wantsTransfer(searchParams: SearchParams): boolean {
  const value = searchParams.transfer;
  return (Array.isArray(value) ? value[0] : value) === '1';
}

/**
 * Members, pending invitations and the seat summary, read on one workspace-scoped transaction
 * (`loadMembersPage`), plus the workspace's role settings (#285). `seats` is `null` when the plan
 * could not be read.
 */
async function loadMembers(context: WorkspaceContext): Promise<{
  members: MemberRow[];
  invitations: InvitationRow[];
  seats: SeatSummary | null;
  policySettings: PolicySettings;
}> {
  const { inWorkspace, loadMembersPage } = await import('@causedeck/core/runtime');
  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  const { members, invitations, seats } = await loadMembersPage(scope);
  // Imported after the runtime, not alongside it: concurrent imports race the test mocks.
  const { getRoleSettings, toPolicySettings } = await import('@causedeck/core/workspaces');
  const roleSettings = await inWorkspace(scope, (tx) => getRoleSettings(tx, scope.workspaceId));
  return {
    policySettings: toPolicySettings(roleSettings),
    members: members.flatMap(({ memberId, userId, name, email, role, joinedAt, lastActiveAt }) =>
      isRole(role) ? [{ memberId, userId, name, email, role, joinedAt, lastActiveAt }] : [],
    ),
    invitations: invitations.flatMap(({ id, email, role, invitedAt, expiresAt }) =>
      isRole(role) ? [{ id, email, role, invitedAt, expiresAt }] : [],
    ),
    seats: seats
      ? {
          used: seats.used.nonClerk,
          granted: seats.granted.seats,
          clerkUsed: seats.used.clerk,
          clerkGranted: seats.granted.clerkSeats,
        }
      : null,
  };
}

async function MembersSection({
  context,
  failOnPurpose,
  openTransfer,
}: {
  context: WorkspaceContext;
  failOnPurpose: boolean;
  openTransfer: boolean;
}) {
  let data: Awaited<ReturnType<typeof loadMembers>>;
  try {
    if (failOnPurpose) throw new Error('Members error state (dev toggle)');
    data = await loadMembers(context);
  } catch (error) {
    if (!failOnPurpose) logger.error({ err: error }, 'members page: could not load members');
    return <MembersError />;
  }
  if (!data.seats) logger.warn('members page: could not read the seat summary');
  return (
    <MembersView
      workspace={context.workspace}
      viewer={{ userId: context.user.id, role: context.role }}
      members={data.members}
      invitations={data.invitations}
      seats={data.seats}
      openTransfer={openTransfer}
      policySettings={data.policySettings}
      actions={{
        invite: inviteMembersAction,
        changeRole: changeRoleAction,
        prepareTransfer: prepareTransferAction,
        confirmTransfer: confirmTransferAction,
        openWork: openWorkAction,
        removeMember: removeMemberAction,
        resendInvitation: resendInvitationAction,
        revokeInvitation: revokeInvitationAction,
      }}
    />
  );
}

export default async function MembersPage({ params, searchParams }: MembersPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('members');
  const state = devState(query);

  return (
    <div data-route="members" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">
          {t('description', { workspace: context.workspace.name })}
        </p>
        {canOpenSettings(context.role, 'roles') ? (
          <Link
            href={settingsHref(context.workspace.slug, 'roles')}
            data-slot="roles-link"
            className="text-accent focus-visible:outline-ring w-fit text-sm underline-offset-4 outline-offset-2 hover:underline focus-visible:outline-2"
          >
            {t('rolesLink')}
          </Link>
        ) : null}
      </header>
      {state === 'loading' ? (
        <MembersSkeleton />
      ) : (
        <Suspense fallback={<MembersSkeleton />}>
          <MembersSection
            context={context}
            failOnPurpose={state === 'error'}
            openTransfer={wantsTransfer(query)}
          />
        </Suspense>
      )}
    </div>
  );
}
