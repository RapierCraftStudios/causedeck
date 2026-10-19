'use client';
// The members list (#181, #18 UI spec). Under 768 px members are stacked cards with a sticky
// full-width `Invite member` bar; from 768 a table (Member, Role, Status, Last active); from
// 1280 the table plus a `Roles` explainer. Pending invitations are listed with members (Status
// `Invited`). What a row offers depends on the caller's role: owners manage members, owners and
// advocates manage the invitations they could have sent, everyone else sees the list read-only.
// Offline the page is read-only and `Invite member` says it needs a connection. The dialogs load on
// first use.
import { invitableRoles } from '@causedeck/auth/policy';
import { Alert } from '@causedeck/ui/alert';
import { Avatar } from '@causedeck/ui/avatar';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@causedeck/ui/dropdown-menu';
import { EmptyState } from '@causedeck/ui/empty-state';
import { useReducedMotion } from '@causedeck/ui/hooks';
import { IconButton } from '@causedeck/ui/icon-button';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { toast } from '@causedeck/ui/sonner';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@causedeck/ui/table';
import { CircleCheck, Mail, MoreHorizontal, UserPlus, Users } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent } from 'react';

import type { Result } from '../../../../../../lib/safe-action.ts';
import { can, type Role } from '../../../../../../lib/workspace-context.ts';

import type { InviteMembers } from './invite-dialog.tsx';
import type { RemoveMemberActions } from './remove-member-dialog.tsx';
import {
  ChangeRoleDialog,
  errorKeyFor,
  ROLE_ORDER,
  RolePill,
  useOnline,
  type ChangeRoleActions,
} from './role-select.tsx';

const InviteDialog = dynamic(() => import('./invite-dialog.tsx').then((m) => m.InviteDialog), {
  ssr: false,
});
const RemoveMemberDialog = dynamic(
  () => import('./remove-member-dialog.tsx').then((m) => m.RemoveMemberDialog),
  { ssr: false },
);

/** Row removal collapses over `--dur-base` (200 ms); instant under reduced motion. */
const LEAVE_MS = 200;

export interface MemberRow {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
  lastActiveAt: Date | null;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  invitedAt: Date;
  expiresAt: Date;
}

export interface MembersActions extends ChangeRoleActions, RemoveMemberActions {
  invite: InviteMembers;
  resendInvitation: (input: {
    workspaceId: string;
    invitationId: string;
  }) => Promise<Result<{ email: string; link?: string }>>;
  revokeInvitation: (input: {
    workspaceId: string;
    invitationId: string;
  }) => Promise<Result<{ invitationId: string }>>;
}

export interface MembersViewProps {
  workspace: { id: string; slug: string; name: string };
  viewer: { userId: string; role: Role };
  members: readonly MemberRow[];
  invitations: readonly InvitationRow[];
  actions: MembersActions;
}

type Row =
  | { kind: 'member'; key: string; member: MemberRow }
  | { kind: 'invitation'; key: string; invitation: InvitationRow };

type Dialog =
  | { kind: 'invite' }
  | { kind: 'role'; member: MemberRow; intent: 'role' | 'transfer' }
  | { kind: 'remove'; member: MemberRow };

/** Six skeleton rows in the shape of the list, never a spinner-only screen. */
export function MembersSkeleton() {
  const t = useTranslations('members');
  return (
    <SkeletonGroup
      data-slot="members-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-3"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="border-line flex items-center gap-3 border-b py-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

/** `Could not load members.` with `Try again`, which re-runs the page's server render. */
export function MembersError() {
  const t = useTranslations('members.error');
  const router = useRouter();
  return (
    <Alert
      tone="danger"
      data-pattern-state="error"
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            router.refresh();
          }}
        >
          {t('retry')}
        </Button>
      }
    >
      {t('title')}
    </Alert>
  );
}

function StatusBadge({ invited }: { invited: boolean }) {
  const t = useTranslations('members.status');
  return invited ? (
    <Badge tone="neutral" data-status="invited">
      <Mail aria-hidden="true" />
      {t('invited')}
    </Badge>
  ) : (
    <Badge tone="success" data-status="active">
      <CircleCheck aria-hidden="true" />
      {t('active')}
    </Badge>
  );
}

function RolesPanel() {
  const t = useTranslations('members');
  return (
    <aside
      aria-labelledby="members-roles-title"
      data-slot="roles-panel"
      className="border-line bg-surface hidden h-fit flex-col gap-4 rounded-lg border p-5 xl:flex"
    >
      <header className="flex flex-col gap-1">
        <h2 id="members-roles-title" className="font-serif text-lg font-medium">
          {t('rolesPanel.title')}
        </h2>
        <p className="text-ink-muted text-sm">{t('rolesPanel.description')}</p>
      </header>
      <dl className="flex flex-col gap-3">
        {ROLE_ORDER.map((role) => (
          <div key={role} className="flex flex-col gap-1">
            <dt>
              <RolePill role={role} />
            </dt>
            <dd className="text-ink-muted text-sm">{t(`roleDescriptions.${role}`)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-ink border-line border-t pt-3 text-sm">{t('rolesPanel.clerkNote')}</p>
    </aside>
  );
}

export function MembersView({
  workspace,
  viewer,
  members,
  invitations,
  actions,
}: MembersViewProps) {
  const t = useTranslations('members');
  const format = useFormatter();
  const router = useRouter();
  const online = useOnline();
  const reduced = useReducedMotion();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  // The central policy decides (#234); the server actions and domain service check it again.
  const isOwner = can(viewer.role, 'member.role');
  const canManageMembers = isOwner && can(viewer.role, 'member.remove');
  const invitable = invitableRoles(viewer.role).filter(
    (role): role is Exclude<Role, 'owner'> => role !== 'owner',
  );
  const canInvite = invitable.length > 0;
  const rows: Row[] = [
    ...members.map((member) => ({ kind: 'member' as const, key: member.memberId, member })),
    ...invitations.map((invitation) => ({
      kind: 'invitation' as const,
      key: invitation.id,
      invitation,
    })),
  ];
  const empty = members.length <= 1 && invitations.length === 0;

  function date(value: Date) {
    return format.dateTime(value, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function lastActive(row: Row): string {
    if (row.kind === 'invitation') return t('invitedOn', { date: date(row.invitation.invitedAt) });
    return row.member.lastActiveAt ? date(row.member.lastActiveAt) : t('lastActive.never');
  }

  function canManageInvitation(invitation: InvitationRow): boolean {
    return invitable.includes(invitation.role as Exclude<Role, 'owner'>);
  }

  function hasMenu(row: Row): boolean {
    return row.kind === 'member' ? canManageMembers : canManageInvitation(row.invitation);
  }

  async function invitationAction<T extends object>(
    call: () => Promise<Result<T>>,
    message: (email: string) => string,
    email: string,
  ) {
    if (!navigator.onLine) {
      toast(t('errors.offline'));
      return;
    }
    try {
      const result = await call();
      if (!result.ok) {
        toast(t(`errors.${errorKeyFor(result.error.code)}`));
        return;
      }
      // Only `Resend` returns a link, and only with the dev mailer.
      const link =
        'link' in result.data && typeof result.data.link === 'string'
          ? result.data.link
          : undefined;
      toast(
        message(email),
        link
          ? {
              action: {
                label: t('invite.copyLink'),
                onClick: () => {
                  if ('clipboard' in navigator) {
                    void navigator.clipboard
                      .writeText(link)
                      .then(() => toast(t('invite.linkCopied')));
                  }
                },
              },
            }
          : undefined,
      );
    } catch {
      toast(t('errors.generic'));
    }
  }

  function onRemoved(memberId: string) {
    const removed = members.find((m) => m.memberId === memberId);
    if (removed) toast(t('remove.success', { name: removed.name, workspace: workspace.name }));
    setLeaving((current) => new Set([...current, memberId]));
    window.setTimeout(
      () => {
        router.refresh();
      },
      reduced ? 0 : LEAVE_MS,
    );
  }

  /** The phone cards and the table each render a menu per row; `layout` keeps them apart. */
  function rowMenu(row: Row, label: string, layout: 'card' | 'table') {
    if (!hasMenu(row)) return null;
    const id = `${layout}:${row.key}`;
    return (
      <DropdownMenu
        open={menuFor === id}
        onOpenChange={(open) => {
          setMenuFor(open ? id : null);
        }}
      >
        <DropdownMenuTrigger asChild disabled={!online}>
          <IconButton label={t('menu.label', { name: label })} variant="ghost" size="sm">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {row.kind === 'member' ? (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  setDialog({ kind: 'role', member: row.member, intent: 'role' });
                }}
              >
                {t('menu.changeRole')}
              </DropdownMenuItem>
              {row.member.role !== 'owner' ? (
                <DropdownMenuItem
                  onSelect={() => {
                    setDialog({ kind: 'role', member: row.member, intent: 'transfer' });
                  }}
                >
                  {t('menu.transferOwnership')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  setDialog({ kind: 'remove', member: row.member });
                }}
              >
                {t('menu.remove')}
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  void invitationAction(
                    () =>
                      actions.resendInvitation({
                        workspaceId: workspace.id,
                        invitationId: row.invitation.id,
                      }),
                    (email) => t('invite.resent', { email }),
                    row.invitation.email,
                  );
                }}
              >
                {t('menu.resend')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  void invitationAction(
                    () =>
                      actions.revokeInvitation({
                        workspaceId: workspace.id,
                        invitationId: row.invitation.id,
                      }),
                    (email) => t('invite.revoked', { email }),
                    row.invitation.email,
                  );
                }}
              >
                {t('menu.revoke')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, index: number, row: Row) {
    if (event.target !== event.currentTarget) return;
    let next = index;
    if (event.key === 'ArrowDown') next = Math.min(index + 1, rows.length - 1);
    else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key === 'Enter') {
      if (hasMenu(row) && online) {
        event.preventDefault();
        setMenuFor(`table:${row.key}`);
      }
      return;
    } else return;
    event.preventDefault();
    setFocusIndex(next);
    rowRefs.current[next]?.focus();
  }

  function identity(row: Row) {
    const name = row.kind === 'member' ? row.member.name : row.invitation.email;
    const email = row.kind === 'member' ? row.member.email : null;
    const self = row.kind === 'member' && row.member.userId === viewer.userId;
    return (
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={name} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {name}
            {self ? <span className="text-ink-muted font-normal"> ({t('you')})</span> : null}
          </span>
          {email ? <span className="text-ink-muted truncate text-xs">{email}</span> : null}
        </div>
      </div>
    );
  }

  const readOnlyNote = isOwner
    ? null
    : viewer.role === 'viewer'
      ? t('readOnly.viewer')
      : t('readOnly.member');

  const inviteButton = (className: string) =>
    canInvite ? (
      <div className={className}>
        <Button
          onClick={() => {
            setDialog({ kind: 'invite' });
          }}
          disabled={!online}
          aria-describedby={online ? undefined : 'members-invite-offline'}
          className="w-full md:w-auto"
        >
          <UserPlus aria-hidden="true" />
          {t('inviteButton')}
        </Button>
        {online ? null : (
          <p id="members-invite-offline" className="text-ink-muted text-center text-xs md:text-end">
            {t('needsConnection')}
          </p>
        )}
      </div>
    ) : null;

  return (
    <div
      data-slot="members"
      data-online={online ? 'true' : 'false'}
      className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="flex min-w-0 flex-col gap-4">
        {readOnlyNote ? (
          <Alert tone="neutral" data-slot="members-read-only">
            {readOnlyNote}
          </Alert>
        ) : null}
        {inviteButton('hidden flex-col items-end gap-1 md:flex')}

        <ul
          className="flex flex-col gap-2 md:hidden"
          aria-label={t('tableCaption', { workspace: workspace.name })}
        >
          {rows.map((row) => {
            const role = row.kind === 'member' ? row.member.role : row.invitation.role;
            const label = row.kind === 'member' ? row.member.name : row.invitation.email;
            return (
              <li
                key={row.key}
                data-row={row.kind}
                data-leaving={leaving.has(row.key) ? '' : undefined}
                className="grid grid-rows-[1fr] transition-[grid-template-rows,opacity] duration-(--dur-base) ease-(--ease-standard) data-leaving:grid-rows-[0fr] data-leaving:opacity-0"
              >
                <div className="overflow-hidden">
                  <div className="border-line bg-surface flex items-center gap-3 rounded-lg border p-3">
                    <div className="min-w-0 flex-1">{identity(row)}</div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <RolePill role={role} />
                      {row.kind === 'invitation' ? <StatusBadge invited /> : null}
                    </div>
                    {rowMenu(row, label, 'card')}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <Table className="hidden md:table" containerClassName="max-md:hidden">
          <TableCaption className="sr-only">
            {t('tableCaption', { workspace: workspace.name })}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('columns.member')}</TableHead>
              <TableHead scope="col">{t('columns.role')}</TableHead>
              <TableHead scope="col">{t('columns.status')}</TableHead>
              <TableHead scope="col">{t('columns.lastActive')}</TableHead>
              <TableHead scope="col" className="w-12">
                <span className="sr-only">{t('columns.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => {
              const role = row.kind === 'member' ? row.member.role : row.invitation.role;
              const label = row.kind === 'member' ? row.member.name : row.invitation.email;
              return (
                <TableRow
                  key={row.key}
                  ref={(node) => {
                    rowRefs.current[index] = node;
                  }}
                  tabIndex={index === focusIndex ? 0 : -1}
                  data-row={row.kind}
                  data-leaving={leaving.has(row.key) ? '' : undefined}
                  onFocus={() => {
                    setFocusIndex(index);
                  }}
                  onKeyDown={(event) => {
                    onRowKeyDown(event, index, row);
                  }}
                  className="focus-visible:outline-ring transition-opacity duration-(--dur-base) ease-(--ease-standard) focus-visible:outline-2 focus-visible:-outline-offset-2 data-leaving:opacity-0"
                >
                  <TableCell className="max-w-0 min-w-56">{identity(row)}</TableCell>
                  <TableCell>
                    <RolePill role={role} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge invited={row.kind === 'invitation'} />
                  </TableCell>
                  <TableCell className="text-ink-muted" data-col="last-active">
                    {lastActive(row)}
                  </TableCell>
                  <TableCell className="text-end">{rowMenu(row, label, 'table')}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {empty ? (
          <EmptyState
            data-pattern-state="empty"
            icon={<Users />}
            title={t('empty')}
            className="py-8"
          />
        ) : null}

        {inviteButton(
          'bg-surface/95 border-line sticky bottom-[calc(56px+env(safe-area-inset-bottom))] -mx-4 flex flex-col gap-1 border-t px-4 py-3 md:hidden',
        )}
      </div>

      <RolesPanel />

      {dialog?.kind === 'invite' ? (
        <InviteDialog
          workspace={workspace}
          roles={invitable}
          invite={actions.invite}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'role' ? (
        <ChangeRoleDialog
          workspace={workspace}
          member={dialog.member}
          intent={dialog.intent}
          actions={actions}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'remove' ? (
        <RemoveMemberDialog
          workspace={workspace}
          member={dialog.member}
          candidates={members
            .filter((m) => m.memberId !== dialog.member.memberId)
            .map((m) => ({ memberId: m.memberId, name: m.name }))}
          actions={actions}
          onRemoved={onRemoved}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}
