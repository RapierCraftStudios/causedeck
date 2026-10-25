// @vitest-environment jsdom
// Staff support-session pages and actions (#314): the list with its `No support sessions.` empty
// state, the request action (reason required, workspace id validated before core is called), the
// end action (own sessions only), and the session page, which shows content only for an active
// `view` session, under the fixed `SUPPORT SESSION: READ-ONLY` bar (a status live region).
// Core runtime and the staff gate are mocked; modules are imported one at a time (not with
// Promise.all) so vi.mock applies to every import.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupportSession, SupportWorkspaceView } from '@causedeck/core/support';

const runtime = vi.hoisted(() => ({
  listStaffSupportSessionsFor: vi.fn(),
  staffSupportSessionFor: vi.fn(),
  supportWorkspaceViewFor: vi.fn(),
  requestSupportSessionFor: vi.fn(),
  revokeSupportSessionFor: vi.fn(),
}));
const STAFF = {
  userId: '00000000-0000-4000-8000-0000000f0314',
  email: 'support@causedeck.test',
  role: 'support' as const,
  ip: '203.0.113.9',
  requestId: 'req-314',
};
const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  refresh: vi.fn(),
}));

vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('../lib/staff.ts', () => ({ requireStaff: vi.fn(() => Promise.resolve(STAFF)) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: navigation.notFound,
  redirect: navigation.redirect,
  useRouter: () => ({ refresh: navigation.refresh }),
}));

const { SupportSessionInactiveError } = await import('@causedeck/core/support');
const { WorkspaceError } = await import('@causedeck/core/workspaces');
const { default: SupportPage } = await import('../app/(console)/support/page.tsx');
const { default: SupportSessionPage } = await import('../app/(console)/support/[id]/page.tsx');
const actions = await import('../app/(console)/support/actions.ts');
const { countdown } = await import('../components/support/format.ts');
const { announcement } = await import('../components/support/read-only-bar.tsx');

const WORKSPACE = '00000000-0000-4000-8000-00000000a001';
const SESSION = '00000000-0000-4000-8000-0000000e3141';

function session(overrides: Partial<SupportSession> = {}): SupportSession {
  return {
    id: SESSION,
    workspaceId: WORKSPACE,
    requestedByStaff: STAFF.userId,
    requestedByUser: null,
    grantedByUser: null,
    scope: 'view',
    reason: 'Hearing dates stopped syncing',
    status: 'requested',
    createdAt: new Date(Date.now() - 10 * 60_000),
    grantedAt: null,
    expiresAt: null,
    endedAt: null,
    ...overrides,
  };
}

const active = (overrides: Partial<SupportSession> = {}) =>
  session({
    status: 'granted',
    grantedAt: new Date(Date.now() - 5 * 60_000),
    expiresAt: new Date(Date.now() + 55 * 60_000),
    ...overrides,
  });

const VIEW: Omit<SupportWorkspaceView, 'session'> = {
  profile: {
    id: WORKSPACE,
    name: 'Meenakshi Iyer Law Practice',
    slug: 'chennai-solo',
    kind: 'solo',
    timezone: 'Asia/Kolkata',
    locale: 'en',
    practiceCity: 'Chennai',
  },
  members: [{ name: 'Meenakshi Iyer', role: 'owner', joinedAt: new Date('2026-01-05') }],
};

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

beforeEach(() => {
  for (const fn of Object.values(runtime)) fn.mockReset();
  navigation.notFound.mockClear();
  navigation.redirect.mockClear();
});
afterEach(cleanup);

describe('the support sessions list', () => {
  it('shows the empty state and the request form', async () => {
    runtime.listStaffSupportSessionsFor.mockResolvedValue([]);
    render(await SupportPage({ searchParams: Promise.resolve({}) }));
    expect(runtime.listStaffSupportSessionsFor).toHaveBeenCalledWith(STAFF.userId);
    expect(screen.getByText('No support sessions.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request session' })).toBeTruthy();
    expect(screen.getByLabelText('Reason')).toBeTruthy();
  });

  it("lists the staff member's sessions with their state, linking to each", async () => {
    runtime.listStaffSupportSessionsFor.mockResolvedValue([
      active(),
      session({ id: '00000000-0000-4000-8000-0000000e3142', status: 'denied' }),
      active({
        id: '00000000-0000-4000-8000-0000000e3143',
        expiresAt: new Date(Date.now() - 60_000),
      }),
    ]);
    render(await SupportPage({ searchParams: Promise.resolve({ workspace: WORKSPACE }) }));
    expect(screen.queryByText('No support sessions.')).toBeNull();
    const rows = document.querySelectorAll('[data-slot="support-session-row"]');
    expect(rows).toHaveLength(3);
    const states = [...document.querySelectorAll('[data-slot="support-session-state"]')].map((el) =>
      el.getAttribute('data-state'),
    );
    // An elapsed grant is expired before the job runs.
    expect(states).toEqual(['active', 'denied', 'expired']);
    expect(
      within(rows[0] as HTMLElement)
        .getByRole('link')
        .getAttribute('href'),
    ).toBe(`/support/${SESSION}`);
    // `?workspace=` prefills the request form.
    expect(screen.getByLabelText<HTMLInputElement>('Workspace ID').value).toBe(WORKSPACE);
  });
});

describe('requestSupportSessionAction', () => {
  it('requires a reason and a workspace uuid before calling core', async () => {
    expect(
      await actions.requestSupportSessionAction(
        {},
        form({ workspaceId: WORKSPACE, reason: '   ', scope: 'view' }),
      ),
    ).toMatchObject({ error: expect.stringContaining('A reason is required') as unknown });
    expect(
      await actions.requestSupportSessionAction(
        {},
        form({ workspaceId: 'chennai-solo', reason: 'Help', scope: 'view' }),
      ),
    ).toMatchObject({ error: 'Enter the workspace ID (a UUID).' });
    expect(runtime.requestSupportSessionFor).not.toHaveBeenCalled();
  });

  it('requests as the signed-in staff member and opens the new session', async () => {
    runtime.requestSupportSessionFor.mockResolvedValue(session());
    await expect(
      actions.requestSupportSessionAction(
        {},
        form({ workspaceId: ` ${WORKSPACE} `, reason: ' Sync broken ', scope: 'view' }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT:/support/${SESSION}`);
    expect(runtime.requestSupportSessionFor).toHaveBeenCalledWith(
      { staffUserId: STAFF.userId, ip: STAFF.ip, requestId: STAFF.requestId },
      { workspaceId: WORKSPACE, reason: 'Sync broken', scope: 'view' },
    );
  });

  it('turns an unknown workspace into a form error', async () => {
    runtime.requestSupportSessionFor.mockRejectedValue(new WorkspaceError('NOT_FOUND', 'nope'));
    expect(
      await actions.requestSupportSessionAction(
        {},
        form({ workspaceId: WORKSPACE, reason: 'Help', scope: 'metadata' }),
      ),
    ).toMatchObject({ error: 'Workspace not found.', values: { scope: 'metadata' } });
  });
});

describe('endSupportSessionAction', () => {
  it("ends the staff member's own session in its workspace", async () => {
    runtime.staffSupportSessionFor.mockResolvedValue(active());
    runtime.revokeSupportSessionFor.mockResolvedValue(active({ status: 'ended' }));
    await actions.endSupportSessionAction(form({ sessionId: SESSION }));
    expect(runtime.staffSupportSessionFor).toHaveBeenCalledWith(STAFF.userId, SESSION);
    expect(runtime.revokeSupportSessionFor).toHaveBeenCalledWith(
      { userId: STAFF.userId, workspaceId: WORKSPACE, ip: STAFF.ip, requestId: STAFF.requestId },
      { sessionId: SESSION },
    );
  });

  it("is the generic 404 for a session that is not the staff member's", async () => {
    runtime.staffSupportSessionFor.mockResolvedValue(null);
    await expect(actions.endSupportSessionAction(form({ sessionId: SESSION }))).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(runtime.revokeSupportSessionFor).not.toHaveBeenCalled();
  });

  it('treats an already-ended session as ended', async () => {
    runtime.staffSupportSessionFor.mockResolvedValue(active());
    runtime.revokeSupportSessionFor.mockRejectedValue(new WorkspaceError('CONFLICT', 'ended'));
    await expect(actions.endSupportSessionAction(form({ sessionId: SESSION }))).resolves.toBe(
      undefined,
    );
  });
});

describe('the support session page', () => {
  const open = async () =>
    render(await SupportSessionPage({ params: Promise.resolve({ id: SESSION }) }));

  it('shows an active view session under the fixed read-only bar, announced', async () => {
    const s = active();
    runtime.staffSupportSessionFor.mockResolvedValue(s);
    runtime.supportWorkspaceViewFor.mockResolvedValue({ session: s, ...VIEW });
    await open();
    expect(runtime.supportWorkspaceViewFor).toHaveBeenCalledWith(
      { staffUserId: STAFF.userId, ip: STAFF.ip, requestId: STAFF.requestId },
      WORKSPACE,
    );
    const bar = document.querySelector('[data-slot="support-read-only-bar"]') as HTMLElement;
    expect(bar.textContent).toContain('SUPPORT SESSION: READ-ONLY');
    expect(bar.className).toContain('bg-danger-soft');
    expect(bar.className).toContain('fixed');
    expect(within(bar).getByRole('status').textContent).toMatch(/read-only, until \d\d:\d\d/);
    expect(document.querySelector('[data-slot="support-view"]')?.textContent).toContain(
      'Meenakshi Iyer Law Practice',
    );
    expect(document.querySelector('[data-slot="support-countdown"]')?.textContent).toMatch(
      /Ends in \d\d:\d\d/,
    );
    expect(screen.getByRole('button', { name: 'End session' })).toBeTruthy();
  });

  it('shows no content when the session stopped being active before the read', async () => {
    runtime.staffSupportSessionFor.mockResolvedValue(active());
    runtime.supportWorkspaceViewFor.mockRejectedValue(new SupportSessionInactiveError());
    await open();
    expect(document.querySelector('[data-slot="support-read-only-bar"]')).toBeNull();
    expect(document.querySelector('[data-slot="support-view"]')).toBeNull();
    expect(
      document.querySelector('[data-slot="support-session"]')?.getAttribute('data-state'),
    ).toBe('ended');
  });

  it('never reads content for metadata, pending, denied or expired sessions', async () => {
    for (const s of [
      active({ scope: 'metadata' }),
      session(),
      session({ status: 'denied' }),
      active({ expiresAt: new Date(Date.now() - 1000) }),
    ]) {
      runtime.staffSupportSessionFor.mockResolvedValue(s);
      await open();
      expect(document.querySelector('[data-slot="support-read-only-bar"]')).toBeNull();
      expect(document.querySelector('[data-slot="support-view"]')).toBeNull();
      cleanup();
    }
    expect(runtime.supportWorkspaceViewFor).not.toHaveBeenCalled();
  });

  it('offers no way to extend: pending can be withdrawn, ended sessions only show their state', async () => {
    runtime.staffSupportSessionFor.mockResolvedValue(session());
    await open();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Withdraw request']);
    cleanup();
    runtime.staffSupportSessionFor.mockResolvedValue(session({ status: 'ended' }));
    await open();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it("is the generic 404 for someone else's or an unknown session", async () => {
    runtime.staffSupportSessionFor.mockResolvedValue(null);
    await expect(open()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('countdown and announcements', () => {
  it('formats the time left', () => {
    expect(countdown(65_000)).toBe('01:05');
    expect(countdown(2 * 3_600_000 + 61_000)).toBe('2:01:01');
    expect(countdown(-5)).toBe('00:00');
  });

  it('announces at 5 and 1 minutes left, not every second', () => {
    expect(announcement(30 * 60_000, '14:30')).toContain('until 14:30');
    expect(announcement(4 * 60_000, '14:30')).toContain('5 minutes or less');
    expect(announcement(30_000, '14:30')).toContain('less than 1 minute');
    expect(announcement(0, '14:30')).toBe('Support session ended.');
  });
});
