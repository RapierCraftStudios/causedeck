// `/w/[slug]/settings/members` (#181): who is in the workspace, with what role, and pending
// invitations. Every member may look; what they may change is decided per role in the client view
// and enforced again by the domain service behind each server action. The settings shell and its
// navigation arrive in #25.
//
// States: loading (six skeleton rows while the list streams in), error (`Could not load members.`
// with `Try again`), empty (only the caller, no invitations), offline and permission-denied (in the
// client view). `?__state=loading|error` previews the first two in development, like the shell.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ShellOfflineBanner } from '../../../../../../components/shell/offline-banner.tsx';
import { isDev } from '../../../../../../lib/env.ts';
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

/** Members and pending invitations, read on one workspace-scoped transaction (`loadMembersPage`). */
async function loadMembers(
  context: WorkspaceContext,
): Promise<{ members: MemberRow[]; invitations: InvitationRow[] }> {
  const { loadMembersPage } = await import('@causedeck/core/runtime');
  const { members, invitations } = await loadMembersPage({
    workspaceId: context.workspace.id,
    userId: context.user.id,
  });
  return {
    members: members.flatMap(({ memberId, userId, name, email, role, joinedAt, lastActiveAt }) =>
      isRole(role) ? [{ memberId, userId, name, email, role, joinedAt, lastActiveAt }] : [],
    ),
    invitations: invitations.flatMap(({ id, email, role, invitedAt, expiresAt }) =>
      isRole(role) ? [{ id, email, role, invitedAt, expiresAt }] : [],
    ),
  };
}

async function MembersSection({
  context,
  failOnPurpose,
}: {
  context: WorkspaceContext;
  failOnPurpose: boolean;
}) {
  let data: Awaited<ReturnType<typeof loadMembers>>;
  try {
    if (failOnPurpose) throw new Error('Members error state (dev toggle)');
    data = await loadMembers(context);
  } catch (error) {
    if (!failOnPurpose) logger.error({ err: error }, 'members page: could not load members');
    return <MembersError />;
  }
  return (
    <MembersView
      workspace={context.workspace}
      viewer={{ userId: context.user.id, role: context.role }}
      members={data.members}
      invitations={data.invitations}
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
      <ShellOfflineBanner />
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">
          {t('description', { workspace: context.workspace.name })}
        </p>
      </header>
      {state === 'loading' ? (
        <MembersSkeleton />
      ) : (
        <Suspense fallback={<MembersSkeleton />}>
          <MembersSection context={context} failOnPurpose={state === 'error'} />
        </Suspense>
      )}
    </div>
  );
}
