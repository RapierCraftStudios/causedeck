'use client';
// The members list (#181, #18 UI spec). Under 768 px members are stacked cards with a sticky
// full-width `Invite member` bar; from 768 a table (Member, Role, Status, Last active); from
// 1280 the table plus a `Roles` explainer (below 1280 a collapsible `About roles`). A seat summary
// (seats in use against the plan) sits above two tabs (#288): `Members` and `Pending invitations`,
// each with its own empty state. What a row offers depends on the caller's role: owners manage
// members, owners and advocates manage the invitations they could have sent, everyone else sees
// the list read-only. Offline the page is read-only and `Invite member` says it needs a connection.
// `openTransfer` (the danger zone's `Transfer ownership`) opens a picker for the new owner, then
// the two-step transfer. The invite and remove dialogs load on first use.
import { invitableRoles } from '@causedeck/auth/policy';
import { Alert } from '@causedeck/ui/alert';
import { Avatar } from '@causedeck/ui/avatar';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@causedeck/ui/collapsible';
import {
  Dialog as DialogRoot,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@causedeck/ui/dropdown-menu';
import { EmptyState } from '@causedeck/ui/empty-state';
import { Field } from '@causedeck/ui/field';
import { useReducedMotion } from '@causedeck/ui/hooks';
import { IconButton } from '@causedeck/ui/icon-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@causedeck/ui/select';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@causedeck/ui/tabs';
import {
  ChevronDown,
  CircleCheck,
  Mail,
  MailOpen,
  MoreHorizontal,
  UserPlus,
  Users,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

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

/** Seats in use against the plan: non-clerk seats and clerk seats (priced separately, #28). */
export interface SeatSummary {
  used: number;
  granted: number;
  clerkUsed: number;
  clerkGranted: number;
}

export interface MembersViewProps {
  workspace: { id: string; slug: string; name: string };
  viewer: { userId: string; role: Role };
  members: readonly MemberRow[];
  invitations: readonly InvitationRow[];
  /** `null` when the plan could not be read: the card is hidden, the list still renders. */
  seats?: SeatSummary | null | undefined;
  /** Open the ownership transfer picker on mount (owners only; `?transfer=1`). */
  openTransfer?: boolean | undefined;
  actions: MembersActions;
}

type ListKey = 'members' | 'invitations';

type Row =
  | { kind: 'member'; key: string; member: MemberRow }
  | { kind: 'invitation'; key: string; invitation: InvitationRow };

type Dialog =
  | { kind: 'invite' }
  | { kind: 'transfer-picker' }
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

function RolesList() {
  const t = useTranslations('members');
  return (
    <>
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
    </>
  );
}

/** The roles explainer as a right-hand rail from 1280 px. */
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
      <RolesList />
    </aside>
  );
}

/** The same explainer below 1280 px, collapsed under `About roles`. */
function RolesDisclosure() {
  const t = useTranslations('members');
  return (
    <Collapsible
      data-slot="roles-disclosure"
      className="border-line bg-surface rounded-lg border xl:hidden"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group focus-visible:outline-ring flex w-full items-center justify-between gap-2 rounded-lg p-4 text-start text-sm font-medium focus-visible:outline-2"
        >
          {t('aboutRoles')}
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform duration-(--dur-fast) group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <p className="text-ink-muted text-sm">{t('rolesPanel.description')}</p>
          <RolesList />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Seats in use against the plan; an `Over plan limit` badge when either count is past it. */
function SeatSummaryCard({ seats }: { seats: SeatSummary }) {
  const t = useTranslations('members.seats');
  const over = seats.used > seats.granted || seats.clerkUsed > seats.clerkGranted;
  return (
    <section
      data-slot="seat-summary"
      aria-labelledby="members-seats-title"
      className="border-line bg-surface flex flex-col gap-1 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="members-seats-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        {over ? (
          <Badge tone="warning" data-slot="seat-over-limit">
            {t('overLimit')}
          </Badge>
        ) : null}
      </div>
      <p className="text-sm" data-seats="members">
        {t('used', { used: seats.used, granted: seats.granted })}
      </p>
      {seats.clerkGranted > 0 || seats.clerkUsed > 0 ? (
        <p className="text-sm" data-seats="clerk">
          {t('clerk', { used: seats.clerkUsed, granted: seats.clerkGranted })}
        </p>
      ) : null}
      <p className="text-ink-muted text-xs">{t('note')}</p>
    </section>
  );
}

/** Pick the member who becomes owner, then continue to the two-step transfer. */
function TransferPickerDialog({
  workspace,
  candidates,
  onPick,
  onOpenChange,
}: {
  workspace: { name: string };
  candidates: readonly MemberRow[];
  onPick: (member: MemberRow) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('members.transferPicker');
  const [picked, setPicked] = useState<string>(candidates[0]?.memberId ?? '');
  const member = candidates.find((m) => m.memberId === picked);
  return (
    <DialogRoot open onOpenChange={onOpenChange}>
      <DialogContent data-dialog="transfer-picker">
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (member) onPick(member);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description', { workspace: workspace.name })}</DialogDescription>
          </DialogHeader>
          {candidates.length === 0 ? (
            <Alert tone="neutral">{t('none')}</Alert>
          ) : (
            <Field label={t('label')}>
              <Select value={picked} onValueChange={setPicked}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                {/* Above the dialog overlay (z-overlay) and the dialog itself (z-modal). */}
                <SelectContent className="z-popover">
                  {candidates.map((m) => (
                    <SelectItem key={m.memberId} value={m.memberId}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t('cancel')}
            </Button>
            {candidates.length > 0 ? <Button type="submit">{t('continue')}</Button> : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

export function MembersView({
  workspace,
  viewer,
  members,
  invitations,
  seats,
  openTransfer = false,
  actions,
}: MembersViewProps) {
  const t = useTranslations('members');
  const format = useFormatter();
  const router = useRouter();
  const online = useOnline();
  const reduced = useReducedMotion();
  // The central policy decides (#234); the server actions and domain service check it again.
  const isOwner = can(viewer.role, 'member.role');
  const [dialog, setDialog] = useState<Dialog | null>(
    openTransfer && isOwner ? { kind: 'transfer-picker' } : null,
  );
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocus] = useState<Readonly<Record<ListKey, number>>>({
    members: 0,
    invitations: 0,
  });
  const rowRefs = useRef<Record<ListKey, (HTMLTableRowElement | null)[]>>({
    members: [],
    invitations: [],
  });

  // `?transfer=1` opens the picker once; drop it so a reload or refresh does not reopen it.
  useEffect(() => {
    if (!openTransfer) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('transfer')) return;
    url.searchParams.delete('transfer');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [openTransfer]);

  const canManageMembers = isOwner && can(viewer.role, 'member.remove');
  const invitable = invitableRoles(viewer.role).filter(
    (role): role is Exclude<Role, 'owner'> => role !== 'owner',
  );
  const canInvite = invitable.length > 0;
  const lists: Record<ListKey, Row[]> = {
    members: members.map((member) => ({ kind: 'member' as const, key: member.memberId, member })),
    invitations: invitations.map((invitation) => ({
      kind: 'invitation' as const,
      key: invitation.id,
      invitation,
    })),
  };
  const transferCandidates = members.filter(
    (m) => m.role !== 'owner' && m.userId !== viewer.userId,
  );

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

  function onRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    list: ListKey,
    index: number,
    row: Row,
  ) {
    if (event.target !== event.currentTarget) return;
    const last = lists[list].length - 1;
    let next = index;
    if (event.key === 'ArrowDown') next = Math.min(index + 1, last);
    else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'Enter') {
      if (hasMenu(row) && online) {
        event.preventDefault();
        setMenuFor(`table:${row.key}`);
      }
      return;
    } else return;
    event.preventDefault();
    setFocus((current) => ({ ...current, [list]: next }));
    rowRefs.current[list][next]?.focus();
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

  /** One tab's rows: stacked cards under 768 px, the table from 768. */
  function rowList(list: ListKey) {
    const rows = lists[list];
    const caption = t('tableCaption', { workspace: workspace.name });
    if (rows.length === 0) return null;
    return (
      <>
        <ul className="flex flex-col gap-2 md:hidden" aria-label={caption}>
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
          <TableCaption className="sr-only">{caption}</TableCaption>
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
                    rowRefs.current[list][index] = node;
                  }}
                  tabIndex={index === focus[list] ? 0 : -1}
                  data-row={row.kind}
                  data-leaving={leaving.has(row.key) ? '' : undefined}
                  onFocus={() => {
                    setFocus((current) => ({ ...current, [list]: index }));
                  }}
                  onKeyDown={(event) => {
                    onRowKeyDown(event, list, index, row);
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
      </>
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
        {seats ? <SeatSummaryCard seats={seats} /> : null}
        {inviteButton('hidden flex-col items-end gap-1 md:flex')}

        <Tabs defaultValue="members">
          <TabsList aria-label={t('tabs.label')}>
            <TabsTrigger value="members">
              <Users aria-hidden="true" />
              {t('tabs.members', { count: members.length })}
            </TabsTrigger>
            <TabsTrigger value="invitations">
              <Mail aria-hidden="true" />
              {t('tabs.invitations', { count: invitations.length })}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="members" className="flex flex-col gap-4">
            {rowList('members')}
            {members.length <= 1 ? (
              <EmptyState
                data-pattern-state="empty"
                icon={<Users />}
                title={t('empty')}
                className="py-8"
              />
            ) : null}
          </TabsContent>
          <TabsContent value="invitations" className="flex flex-col gap-4">
            {rowList('invitations')}
            {invitations.length === 0 ? (
              <EmptyState
                data-pattern-state="empty"
                data-slot="invitations-empty"
                icon={<MailOpen />}
                title={t('invitationsEmpty')}
                className="py-8"
              />
            ) : null}
          </TabsContent>
        </Tabs>

        <RolesDisclosure />

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
      {dialog?.kind === 'transfer-picker' ? (
        <TransferPickerDialog
          workspace={workspace}
          candidates={transferCandidates}
          onPick={(member) => {
            setDialog({ kind: 'role', member, intent: 'transfer' });
          }}
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
