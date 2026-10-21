// @vitest-environment jsdom
// `/w/[slug]/settings/members` (#181): the server page (membership, workspace-scoped load, the
// loading and error states) and the client view (cards/table/Roles panel, role-gated actions,
// empty, offline and read-only states, keyboard, invite chips with `Copy link`, removal with a
// required reassignment, the two-step ownership transfer). #288: the seat summary, the members /
// pending invitations tabs, the roles explainer below 1280, a single (settings) offline banner and
// the `?transfer=1` picker. Every string comes from the catalogs.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockMatchMedia, stubResizeObserver } from '../components/shell/__tests__/helpers.tsx';

import type {
  InvitationRow,
  MemberRow,
  MembersActions,
  SeatSummary,
} from '../app/(app)/w/[slug]/settings/members/members-table.tsx';
import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations, type TestLocale } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  dev: true,
  members: [] as unknown[],
  invitations: [] as unknown[],
  fail: false,
  roleSettings: { advocatesCanInvite: true, ownersSeeRestrictedMatters: true },
  seatsFail: false,
}));
const withWorkspace = vi.hoisted(() =>
  vi.fn((_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      scoped: true,
      // The seat read runs in a savepoint.
      transaction: (inner: (sp: unknown) => Promise<unknown>) => inner(tx),
    };
    return fn(tx);
  }),
);
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('@causedeck/ui/sonner', () => ({ toast }));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => page.dev }));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('@causedeck/db', () => ({ db: { fake: 'db' }, withWorkspace }));
vi.mock('@causedeck/core/workspaces', () => ({
  listMembers: () => (page.fail ? Promise.reject(new Error('db down')) : page.members),
  listPendingInvitations: () => Promise.resolve(page.invitations),
  getRoleSettings: () => Promise.resolve(page.roleSettings),
  toPolicySettings: (settings: unknown) => settings,
  countBillableSeats: () => Promise.resolve({ total: 2, clerk: 0, nonClerk: 2 }),
}));
vi.mock('@causedeck/core/billing', () => ({
  getWorkspaceEntitlements: () =>
    page.seatsFail
      ? Promise.reject(new Error('plan unreadable'))
      : Promise.resolve({ seats: 3, clerk_seats: 1 }),
}));
vi.mock('../app/(app)/w/[slug]/settings/members/actions.ts', () => ({
  inviteMembersAction: vi.fn(),
  changeRoleAction: vi.fn(),
  prepareTransferAction: vi.fn(),
  confirmTransferAction: vi.fn(),
  openWorkAction: vi.fn(),
  removeMemberAction: vi.fn(),
  resendInvitationAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
}));

const { MembersView } = await import('../app/(app)/w/[slug]/settings/members/members-table.tsx');
const { ChangeRoleDialog } = await import('../app/(app)/w/[slug]/settings/members/role-select.tsx');
const { RemoveMemberDialog } =
  await import('../app/(app)/w/[slug]/settings/members/remove-member-dialog.tsx');
const { default: MembersPage } = await import('../app/(app)/w/[slug]/settings/members/page.tsx');

const en = catalogs.en.members;

const WORKSPACE = {
  id: '00000000-0000-4000-8000-00000000a001',
  slug: 'chennai-solo',
  name: 'Iyer Chambers',
};

const owner: MemberRow = {
  memberId: 'm-owner',
  userId: 'u-owner',
  name: 'Meenakshi Iyer',
  email: 'owner@x.test',
  role: 'owner',
  joinedAt: new Date('2026-09-01T00:00:00Z'),
  lastActiveAt: new Date('2026-10-18T09:00:00Z'),
};
const junior: MemberRow = {
  memberId: 'm-junior',
  userId: 'u-junior',
  name: 'Arun Kumar',
  email: 'junior@x.test',
  role: 'junior',
  joinedAt: new Date('2026-09-02T00:00:00Z'),
  lastActiveAt: null,
};
const clerk: MemberRow = {
  ...junior,
  memberId: 'm-clerk',
  userId: 'u-clerk',
  name: 'Selvi R',
  role: 'clerk',
};
const invitedJunior: InvitationRow = {
  id: 'inv-junior',
  email: 'new@x.test',
  role: 'junior',
  invitedAt: new Date('2026-10-10T00:00:00Z'),
  expiresAt: new Date('2026-10-17T00:00:00Z'),
};
const invitedAdvocate: InvitationRow = {
  ...invitedJunior,
  id: 'inv-adv',
  email: 'adv@x.test',
  role: 'advocate',
};

function fakeActions(): { [K in keyof MembersActions]: ReturnType<typeof vi.fn> } & MembersActions {
  return {
    invite: vi.fn(),
    changeRole: vi.fn(),
    prepareTransfer: vi.fn(),
    confirmTransfer: vi.fn(),
    openWork: vi.fn(() => Promise.resolve({ ok: true, data: { count: 0 } })),
    removeMember: vi.fn(),
    resendInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
  } as never;
}

const withIntl = (ui: ReactNode, locale: TestLocale = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

function view(
  props: Partial<{
    role: MemberRow['role'];
    members: MemberRow[];
    invitations: InvitationRow[];
    seats: SeatSummary | null;
    openTransfer: boolean;
    actions: MembersActions;
    locale: TestLocale;
  }> = {},
) {
  const actions = props.actions ?? fakeActions();
  withIntl(
    <MembersView
      workspace={WORKSPACE}
      viewer={{ userId: 'u-owner', role: props.role ?? 'owner' }}
      members={props.members ?? [owner, junior, clerk]}
      invitations={props.invitations ?? [invitedJunior]}
      seats={props.seats}
      openTransfer={props.openTransfer}
      actions={actions}
    />,
    props.locale,
  );
  return actions;
}

let online = true;
beforeEach(() => {
  online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  mockMatchMedia();
  stubResizeObserver();
  page.context = {
    user: { id: 'u-owner', name: 'Meenakshi Iyer', email: 'owner@x.test' },
    workspace: WORKSPACE,
    role: 'owner',
    memberships: [],
  };
  page.dev = true;
  page.members = [owner, junior];
  page.invitations = [];
  page.fail = false;
  page.roleSettings = { advocatesCanInvite: true, ownersSeeRestrictedMatters: true };
  page.seatsFail = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const table = () => screen.getByRole('table');
/** Radix tabs activate on mouse down. */
function openTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });
}
const invitationsTab = /^Pending invitations/;
const membersTab = /^Members \(/;
const menuButton = (name: string) =>
  within(table()).queryByRole('button', { name: en.menu.label.replace('{name}', name) });

/** Render the page, resolving the async members section inside its Suspense boundary. */
async function renderPage(search: Record<string, string> = {}) {
  const tree = (await MembersPage({
    params: Promise.resolve({ slug: WORKSPACE.slug }),
    searchParams: Promise.resolve(search),
  })) as ReactElement<{
    children: [ReactElement, ReactElement<{ children?: unknown }>];
  }>;
  // Children: the header, then the skeleton or the Suspense list. The settings layout owns the
  // offline banner, so the page renders none of its own (#288).
  const [header, body] = tree.props.children;
  const section = (body.props as { children?: ReactElement }).children;
  let content: ReactNode = body;
  if (section && typeof section.type === 'function') {
    const Section = section.type as (props: unknown) => Promise<ReactNode>;
    content = await Section(section.props);
  }
  withIntl(
    <div>
      {header}
      {content}
    </div>,
  );
}

describe('members page (server)', () => {
  it('is not found for a non-member', async () => {
    page.context = null;
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows the title and description and loads members on the workspace transaction', async () => {
    await renderPage();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(en.title);
    expect(heading.className).toContain('font-serif');
    expect(heading.className).toContain('text-2xl');
    expect(screen.getByText(`People in ${WORKSPACE.name} and what they can do.`)).toBeTruthy();
    expect(withWorkspace).toHaveBeenCalledWith(
      { fake: 'db' },
      { workspaceId: WORKSPACE.id, userId: 'u-owner' },
      expect.any(Function),
    );
    expect(within(table()).getByText('Arun Kumar')).toBeTruthy();
  });

  it('links to the roles page (#285) for clerks and up, not for viewers', async () => {
    await renderPage();
    const link = screen.getByRole('link', { name: en.rolesLink });
    expect(link.getAttribute('href')).toBe(`/w/${WORKSPACE.slug}/settings/roles`);
    cleanup();
    page.context = { ...(page.context as WorkspaceContext), role: 'viewer' };
    await renderPage();
    expect(screen.queryByRole('link', { name: en.rolesLink })).toBeNull();
  });

  it('hides inviting from advocates while advocatesCanInvite is off (#285)', async () => {
    page.context = { ...(page.context as WorkspaceContext), role: 'advocate' };
    await renderPage();
    expect(screen.getAllByRole('button', { name: en.inviteButton }).length).toBeGreaterThan(0);
    cleanup();
    page.roleSettings = { advocatesCanInvite: false, ownersSeeRestrictedMatters: true };
    await renderPage();
    expect(screen.queryByRole('button', { name: en.inviteButton })).toBeNull();
    cleanup();
    page.context = { ...page.context, role: 'owner' };
    await renderPage();
    expect(screen.getAllByRole('button', { name: en.inviteButton }).length).toBeGreaterThan(0);
  });

  it('renders no offline banner of its own: the settings layout owns it (#288)', async () => {
    const tree = (await MembersPage({
      params: Promise.resolve({ slug: WORKSPACE.slug }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ children: ReactElement[] }>;
    expect(tree.props.children).toHaveLength(2);
    online = false;
    await renderPage();
    expect(document.querySelector('[data-pattern-state="offline"]')).toBeNull();
  });

  it('shows the seat summary read on the same transaction', async () => {
    await renderPage();
    const card = document.querySelector('[data-slot="seat-summary"]') as HTMLElement;
    expect(card.textContent).toContain('2 of 3 seats in use');
    expect(card.textContent).toContain('0 of 1 clerk seats in use');
  });

  it('still lists members when the seat read fails, without the seat card', async () => {
    page.seatsFail = true;
    await renderPage();
    expect(within(table()).getByText('Arun Kumar')).toBeTruthy();
    expect(document.querySelector('[data-slot="seat-summary"]')).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('passes ?transfer=1 through so an owner lands in the transfer picker', async () => {
    await renderPage({ transfer: '1' });
    expect(await screen.findByRole('dialog', { name: en.transferPicker.title })).toBeTruthy();
  });

  it('shows the error state with Try again when loading fails', async () => {
    page.fail = true;
    await renderPage();
    expect(screen.getByRole('alert').textContent).toContain(en.error.title);
    fireEvent.click(screen.getByRole('button', { name: en.error.retry }));
    expect(router.refresh).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('previews the loading (six skeleton rows) and error states in development', async () => {
    await renderPage({ __state: 'loading' });
    const skeleton = document.querySelector('[data-slot="members-skeleton"]');
    expect(skeleton?.querySelectorAll('.border-b')).toHaveLength(6);
    cleanup();
    await renderPage({ __state: 'error' });
    expect(screen.getByRole('alert').textContent).toContain(en.error.title);
  });

  it('ignores the state toggle outside development', async () => {
    page.dev = false;
    await renderPage({ __state: 'error' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(table()).getByText('Arun Kumar')).toBeTruthy();
  });
});

describe('MembersView', () => {
  it('lists members and invitations in tabbed tables with Member, Role, Status and Last active', () => {
    view();
    expect(screen.getByRole('tab', { name: membersTab }).textContent).toBe('Members (3)');
    expect(screen.getByRole('tab', { name: invitationsTab }).textContent).toBe(
      'Pending invitations (1)',
    );
    const headers = within(table())
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      en.columns.member,
      en.columns.role,
      en.columns.status,
      en.columns.lastActive,
      en.columns.actions,
    ]);
    const rows = within(table()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain(`(${en.you})`);
    expect(rows[1]?.textContent).toContain(en.lastActive.never);
    expect(rows[0]?.querySelector('[data-status="active"]')?.textContent).toBe(en.status.active);
    expect(rows[0]?.querySelector('[data-role="owner"]')?.textContent).toBe(en.roles.owner);
    openTab(invitationsTab);
    const invited = within(table()).getAllByRole('row').slice(1);
    expect(invited).toHaveLength(1);
    // Status is text plus an icon, never colour alone.
    expect(invited[0]?.querySelector('[data-status="invited"]')?.textContent).toBe(
      en.status.invited,
    );
    expect(invited[0]?.textContent).toContain('new@x.test');
  });

  it('shows the pending invitations empty state in its own tab', () => {
    view({ invitations: [] });
    expect(screen.getByRole('tab', { name: invitationsTab }).textContent).toBe(
      'Pending invitations (0)',
    );
    openTab(invitationsTab);
    expect(screen.getByText(en.invitationsEmpty)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('summarises seats in use against the plan, flagging an over-limit plan', () => {
    view({ seats: { used: 2, granted: 3, clerkUsed: 1, clerkGranted: 1 } });
    const card = document.querySelector('[data-slot="seat-summary"]') as HTMLElement;
    expect(within(card).getByRole('heading', { name: en.seats.title })).toBeTruthy();
    expect(card.textContent).toContain('2 of 3 seats in use');
    expect(card.textContent).toContain('1 of 1 clerk seats in use');
    expect(card.querySelector('[data-slot="seat-over-limit"]')).toBeNull();
    cleanup();
    view({ seats: { used: 4, granted: 3, clerkUsed: 0, clerkGranted: 0 } });
    const over = document.querySelector('[data-slot="seat-summary"]') as HTMLElement;
    expect(over.querySelector('[data-slot="seat-over-limit"]')?.textContent).toBe(
      en.seats.overLimit,
    );
    expect(over.querySelector('[data-seats="clerk"]')).toBeNull();
  });

  it('hides the seat card when the plan could not be read', () => {
    view({ seats: null });
    expect(document.querySelector('[data-slot="seat-summary"]')).toBeNull();
    expect(within(table()).getByText('Arun Kumar')).toBeTruthy();
  });

  it('offers the roles explainer below 1280 as a collapsible About roles', () => {
    view();
    const trigger = screen.getByRole('button', { name: en.aboutRoles });
    expect(trigger.closest('[data-slot="roles-disclosure"]')?.className).toContain('xl:hidden');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const disclosure = document.querySelector('[data-slot="roles-disclosure"]') as HTMLElement;
    expect(disclosure.textContent).toContain(en.roleDescriptions.junior);
    expect(disclosure.textContent).toContain(en.rolesPanel.clerkNote);
  });

  it('opens the transfer picker for an owner and continues to the two-step transfer', async () => {
    window.history.replaceState(null, '', '/w/chennai-solo/settings/members?transfer=1');
    view({ openTransfer: true });
    const picker = await screen.findByRole('dialog', { name: en.transferPicker.title });
    expect(window.location.search).toBe('');
    // Only non-owners other than the caller can become owner; the first is preselected.
    fireEvent.click(within(picker).getByRole('button', { name: en.transferPicker.continue }));
    const step = await screen.findByRole('dialog', { name: en.changeRole.title });
    expect(step.textContent).toContain('Arun Kumar');
  });

  it('says to invite someone first when nobody can take ownership', async () => {
    view({ openTransfer: true, members: [owner], invitations: [] });
    const picker = await screen.findByRole('dialog', { name: en.transferPicker.title });
    expect(picker.textContent).toContain(en.transferPicker.none);
    expect(within(picker).queryByRole('button', { name: en.transferPicker.continue })).toBeNull();
  });

  it('ignores ?transfer=1 for anyone but an owner', () => {
    view({ role: 'advocate', openTransfer: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders cards for phones and a Roles panel that states the clerk restriction', () => {
    view();
    expect(document.querySelectorAll('ul[class*="md:hidden"] > li')).toHaveLength(3);
    const panel = screen.getByRole('complementary', { name: en.rolesPanel.title });
    expect(panel.textContent).toContain(en.rolesPanel.clerkNote);
    expect(panel.textContent).toContain(en.roleDescriptions.clerk);
  });

  it('role pills use the semantic soft tokens', () => {
    view({ members: [owner, junior, clerk], invitations: [invitedAdvocate] });
    const pill = (role: string) => within(table()).getAllByText(en.roles[role as 'owner'])[0];
    expect(pill('owner')?.className).toContain('bg-seal/15');
    expect(pill('junior')?.getAttribute('data-tone')).toBe('info');
    expect(pill('clerk')?.getAttribute('data-tone')).toBe('warning');
    openTab(invitationsTab);
    expect(pill('advocate')?.getAttribute('data-tone')).toBe('accent');
  });

  it('shows the empty state when the caller is the only member', () => {
    view({ members: [owner], invitations: [] });
    expect(screen.getByText(en.empty)).toBeTruthy();
  });

  it('gives owners the full row menu', () => {
    view();
    expect(menuButton('Arun Kumar')).toBeTruthy();
    openTab(invitationsTab);
    expect(menuButton('new@x.test')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: en.inviteButton }).length).toBeGreaterThan(0);
    expect(screen.queryByText(en.readOnly.member)).toBeNull();
  });

  it('lets an advocate invite and manage only invitations below them, not members', () => {
    view({ role: 'advocate', invitations: [invitedJunior, invitedAdvocate] });
    expect(screen.getAllByRole('button', { name: en.inviteButton }).length).toBeGreaterThan(0);
    expect(menuButton('Arun Kumar')).toBeNull();
    openTab(invitationsTab);
    expect(menuButton('new@x.test')).toBeTruthy();
    expect(menuButton('adv@x.test')).toBeNull();
    expect(screen.getByText(en.readOnly.member)).toBeTruthy();
  });

  it.each(['junior', 'clerk'] as const)('shows the list read-only to a %s', (role) => {
    view({ role });
    expect(screen.queryByRole('button', { name: en.inviteButton })).toBeNull();
    expect(within(table()).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(en.readOnly.member)).toBeTruthy();
  });

  it('tells a viewer they can view but not change members', () => {
    view({ role: 'viewer' });
    expect(screen.getByText(en.readOnly.viewer)).toBeTruthy();
    expect(within(table()).queryAllByRole('button')).toHaveLength(0);
  });

  it('is read-only offline: invite disabled with "Needs a connection"', () => {
    online = false;
    view();
    for (const button of screen.getAllByRole('button', { name: en.inviteButton })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getAllByText(en.needsConnection).length).toBeGreaterThan(0);
    expect((menuButton('Arun Kumar') as HTMLButtonElement).disabled).toBe(true);
  });

  it('moves between rows with the arrow keys and opens the row menu with Enter', async () => {
    view();
    const rows = within(table()).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    rows[0]?.focus();
    fireEvent.keyDown(rows[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1] as HTMLElement, { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: en.menu.changeRole })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: en.menu.transferOwnership })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: en.menu.remove })).toBeTruthy();
  });

  it('resends an invitation from its row menu', async () => {
    const actions = fakeActions();
    actions.resendInvitation.mockResolvedValue({ ok: true, data: { email: 'new@x.test' } });
    view({ actions });
    openTab(invitationsTab);
    const rows = within(table()).getAllByRole('row').slice(1);
    rows[0]?.focus();
    fireEvent.keyDown(rows[0] as HTMLElement, { key: 'Enter' });
    expect(screen.queryByRole('menuitem', { name: en.menu.changeRole })).toBeNull();
    fireEvent.click(await screen.findByRole('menuitem', { name: en.menu.resend }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Invitation sent again to new@x.test', undefined);
    });
    expect(actions.resendInvitation).toHaveBeenCalledWith({
      workspaceId: WORKSPACE.id,
      invitationId: 'inv-junior',
    });
  });

  it('invites pasted addresses as chips and offers Copy link in dev', async () => {
    const actions = fakeActions();
    actions.invite.mockResolvedValue({
      ok: true,
      data: {
        results: [
          { email: 'a@x.test', status: 'sent', link: 'http://localhost:3000/invite/tok' },
          { email: 'b@x.test', status: 'rateLimited' },
        ],
      },
    });
    view({ actions });
    fireEvent.click(screen.getAllByRole('button', { name: en.inviteButton })[0] as HTMLElement);
    const dialog = await screen.findByRole(
      'dialog',
      { name: en.invite.title },
      // The dialog is a lazy chunk; give it room on a busy runner.
      { timeout: 5000 },
    );
    const input = within(dialog).getByLabelText(new RegExp(en.invite.emailsLabel));
    fireEvent.paste(input, {
      clipboardData: { getData: () => 'a@x.test, B@x.test\nnot-an-email' },
    });
    const chips = () =>
      [...dialog.querySelectorAll('[data-chip]')].map((c) => c.getAttribute('data-chip'));
    expect(chips()).toEqual(['a@x.test', 'b@x.test', 'not-an-email']);
    expect(dialog.querySelector('[data-chip="not-an-email"]')?.hasAttribute('data-invalid')).toBe(
      true,
    );

    // Role radio-cards with plain-language descriptions; owners cannot invite owners.
    const radios = within(dialog).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(within(dialog).getByText(en.roleDescriptions.clerk)).toBeTruthy();
    expect(
      within(dialog)
        .getByRole('radio', { name: new RegExp(en.roles.junior) })
        .getAttribute('data-state'),
    ).toBe('checked');

    const send = within(dialog).getByRole('button', { name: en.invite.submit });
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
    });
    expect(within(dialog).getByRole('alert').textContent).toContain(en.invite.errors.invalidEmails);
    expect(actions.invite).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove not-an-email' }));
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
    });
    expect(actions.invite).toHaveBeenCalledWith({
      workspaceId: WORKSPACE.id,
      emails: ['a@x.test', 'b@x.test'],
      role: 'junior',
      note: undefined,
    });
    const [message, options] = toast.mock.calls[0] as [string, { action: { label: string } }];
    expect(message).toBe('Invitation sent to a@x.test');
    expect(options.action.label).toBe(en.invite.copyLink);
    // The failed address stays as a chip with a line saying why.
    expect(chips()).toEqual(['b@x.test']);
    expect(dialog.textContent).toContain('Too many invitations for now. Try b@x.test again later.');
  });

  it('shows the seat-limit prompt with Manage plan when the plan has no seat left (#203)', async () => {
    const actions = fakeActions();
    actions.invite.mockResolvedValue({
      ok: true,
      data: { results: [{ email: 'c@x.test', status: 'seatLimit', seats: 3 }] },
    });
    view({ actions });
    fireEvent.click(screen.getAllByRole('button', { name: en.inviteButton })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: en.invite.title }, { timeout: 5000 });
    const input = within(dialog).getByLabelText(new RegExp(en.invite.emailsLabel));
    fireEvent.change(input, { target: { value: 'c@x.test' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: en.invite.submit }));
      await Promise.resolve();
    });
    const prompt = await waitFor(() => {
      const found = dialog.querySelector('[data-slot="seat-limit"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(prompt.textContent).toContain(
      'Your plan includes 3 seats. Add a seat to invite more people.',
    );
    expect(prompt.getAttribute('data-tone')).toBe('info');
    const manage = within(prompt).getByRole('link', { name: en.invite.seatLimit.managePlan });
    expect(manage.getAttribute('href')).toBe(`/w/${WORKSPACE.slug}/billing`);
    // The dialog stays open with the address kept, and no danger line repeats it.
    expect(
      [...dialog.querySelectorAll('[data-chip]')].map((c) => c.getAttribute('data-chip')),
    ).toEqual(['c@x.test']);
    expect(dialog.querySelector('[data-slot="invite-failures"]')).toBeNull();
  });

  it('removes a member: the row collapses, then the list refreshes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const actions = fakeActions();
    actions.removeMember.mockResolvedValue({ ok: true, data: { memberId: 'm-junior' } });
    view({ actions });
    const rows = within(table()).getAllByRole('row').slice(1);
    rows[1]?.focus();
    fireEvent.keyDown(rows[1] as HTMLElement, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: en.menu.remove }));
    const dialog = await screen.findByRole('alertdialog', {}, { timeout: 5000 });
    const confirm = within(dialog).getByRole('button', { name: en.remove.submit });
    await waitFor(() => {
      expect((confirm as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => {
      fireEvent.click(confirm);
      await Promise.resolve();
    });
    expect(actions.removeMember).toHaveBeenCalledWith({
      workspaceId: WORKSPACE.id,
      memberId: 'm-junior',
      reassignTo: undefined,
    });
    expect(toast).toHaveBeenCalledWith(`Arun Kumar was removed from ${WORKSPACE.name}.`);
    expect(rows[1]?.hasAttribute('data-leaving')).toBe(true);
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(router.refresh).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('RemoveMemberDialog', () => {
  const props = (actions: MembersActions) => ({
    workspace: WORKSPACE,
    member: { memberId: 'm-junior', name: 'Arun Kumar' },
    candidates: [{ memberId: 'm-owner', name: 'Meenakshi Iyer' }],
    actions,
    onOpenChange: vi.fn(),
    onRemoved: vi.fn(),
  });

  it('lists the consequences and requires a reassignment when open work exists', async () => {
    const actions = fakeActions();
    actions.openWork.mockResolvedValue({ ok: true, data: { count: 2 } });
    withIntl(<RemoveMemberDialog {...props(actions)} />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain(
      `Arun Kumar loses access to ${WORKSPACE.name} straight away.`,
    );
    expect(dialog.textContent).toContain(en.remove.sessions);
    expect(
      await within(dialog).findByText(
        '2 open tasks and obligations move to the member you choose.',
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText(en.remove.reassignLabel)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: en.remove.submit });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(actions.removeMember).not.toHaveBeenCalled();
  });

  it('shows the last-owner conflict in catalog copy', async () => {
    const actions = fakeActions();
    actions.removeMember.mockResolvedValue({
      ok: false,
      error: { code: 'CONFLICT', message: 'raw domain message' },
    });
    const p = props(actions);
    withIntl(<RemoveMemberDialog {...p} />);
    const confirm = screen.getByRole('button', { name: en.remove.submit });
    await waitFor(() => {
      expect((confirm as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => {
      fireEvent.click(confirm);
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toContain(en.errors.lastOwner);
    expect(document.body.textContent).not.toContain('raw domain message');
    expect(p.onRemoved).not.toHaveBeenCalled();
  });
});

describe('ChangeRoleDialog', () => {
  it('transfers ownership in two steps, confirmed by typing the workspace slug', async () => {
    const actions = fakeActions();
    actions.prepareTransfer.mockResolvedValue({
      ok: true,
      data: {
        confirmation: WORKSPACE.slug,
        newOwner: { userId: 'u-junior', name: 'Arun Kumar', email: 'junior@x.test' },
      },
    });
    actions.confirmTransfer.mockResolvedValue({ ok: true, data: { newOwnerUserId: 'u-junior' } });
    const onOpenChange = vi.fn();
    withIntl(
      <ChangeRoleDialog
        workspace={WORKSPACE}
        member={{ memberId: 'm-junior', userId: 'u-junior', name: 'Arun Kumar', role: 'junior' }}
        intent="transfer"
        actions={actions}
        onOpenChange={onOpenChange}
      />,
    );
    expect(screen.getByText(en.changeRole.ownerHint)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.changeRole.continue }));
      await Promise.resolve();
    });
    expect(actions.prepareTransfer).toHaveBeenCalledWith({
      workspaceId: WORKSPACE.id,
      newOwnerUserId: 'u-junior',
    });
    expect(actions.changeRole).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: 'Transfer ownership to Arun Kumar?' });
    expect(dialog.textContent).toContain(en.transfer.consequences.you);
    const submit = within(dialog).getByRole('button', { name: en.transfer.submit });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(
      within(dialog).getByLabelText(new RegExp(`Type ${WORKSPACE.slug} to confirm`)),
      {
        target: { value: WORKSPACE.slug },
      },
    );
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });
    expect(actions.confirmTransfer).toHaveBeenCalledWith({
      workspaceId: WORKSPACE.id,
      newOwnerUserId: 'u-junior',
      confirmation: WORKSPACE.slug,
    });
    expect(toast).toHaveBeenCalledWith(`Arun Kumar now owns ${WORKSPACE.name}.`);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('labels the role select for the member', () => {
    withIntl(
      <ChangeRoleDialog
        workspace={WORKSPACE}
        member={{ memberId: 'm-junior', userId: 'u-junior', name: 'Arun Kumar', role: 'junior' }}
        intent="role"
        actions={fakeActions()}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox', { name: /Role for Arun Kumar/ })).toBeTruthy();
  });
});

describe('i18n', () => {
  it.each(['ta', 'kn'] as const)('renders only %s catalog strings', (locale) => {
    view({ locale });
    const text = document.body.textContent;
    const local = catalogs[locale].members;
    expect(text).toContain(local.columns.member);
    expect(text).toContain(local.rolesPanel.title);
    for (const english of [
      en.columns.member,
      en.columns.lastActive,
      en.rolesPanel.clerkNote,
      en.inviteButton,
    ]) {
      expect(text).not.toContain(english);
    }
  });
});
