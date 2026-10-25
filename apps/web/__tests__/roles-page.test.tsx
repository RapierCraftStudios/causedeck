// @vitest-environment jsdom
// Settings roles page (#285): the permission matrix is rendered from the policy in
// `@causedeck/auth` (every cell matches `MATRIX`) and states the clerk limits; the two role settings
// autosave with an undo toast for owners, roll back on failure and are read-only for everyone else
// and offline; restricted matters list their allowed members, with an empty state and a disabled
// matter picker stub; a load failure shows the error state with `Try again`.
import { ALL_ACTIONS, atLeast, MATRIX, ROLES } from '@causedeck/auth/policy';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  dev: true,
  fail: false,
}));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const workspaces = vi.hoisted(() => ({
  getRoleSettings: vi.fn(() =>
    page.fail
      ? Promise.reject(new Error('db down'))
      : Promise.resolve({ advocatesCanInvite: true, ownersSeeRestrictedMatters: true }),
  ),
}));
const matters = vi.hoisted(() => ({ listMatterRestrictions: vi.fn(() => Promise.resolve([])) }));
const logger = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => page.dev }));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('@causedeck/ui/sonner', () => ({ toast }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/workspaces', () => workspaces);
vi.mock('@causedeck/core/matters', () => matters);
vi.mock('../app/(app)/w/[slug]/settings/roles/actions.ts', () => ({
  updateRoleSettingsAction: vi.fn(),
}));

const { default: RolesPage } = await import('../app/(app)/w/[slug]/settings/roles/page.tsx');
const { PermissionMatrix, clerksLimited } =
  await import('../app/(app)/w/[slug]/settings/roles/permission-matrix.tsx');
const { RoleSettingsForm } =
  await import('../app/(app)/w/[slug]/settings/roles/role-settings-form.tsx');
const { MatterRestrictions } =
  await import('../app/(app)/w/[slug]/settings/roles/matter-restrictions.tsx');

const en = catalogs.en.settings.roles;
const WORKSPACE_ID = '00000000-0000-4000-8000-00000000a001';
const ON = { advocatesCanInvite: true, ownersSeeRestrictedMatters: true };

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

beforeEach(() => {
  page.context = testWorkspaceContext('demo', 'owner');
  page.dev = true;
  page.fail = false;
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('permission matrix', () => {
  it('renders every action and role from MATRIX, cell for cell', async () => {
    withIntl(await PermissionMatrix());
    const rows = document.querySelectorAll('tr[data-action]');
    expect(rows).toHaveLength(ALL_ACTIONS.length);
    for (const action of ALL_ACTIONS) {
      for (const role of ROLES) {
        const cell = document.querySelector(`tr[data-action="${action}"] td[data-role="${role}"]`);
        expect(cell?.getAttribute('data-allowed'), `${action} / ${role}`).toBe(
          String(atLeast(role, MATRIX[action])),
        );
      }
    }
    expect(screen.getByRole('table').querySelector('caption')?.textContent).toBe(en.matrix.caption);
  });

  it('states the clerk limits, derived from the matrix', async () => {
    expect(clerksLimited()).toBe(true);
    withIntl(await PermissionMatrix());
    const callout = document.querySelector('[data-slot="clerk-limits"]');
    expect(callout?.textContent).toContain('Clerks cannot see strategy notes or matter memory');
    for (const action of ['strategy.read', 'memory.read']) {
      expect(
        document
          .querySelector(`tr[data-action="${action}"] td[data-role="clerk"]`)
          ?.getAttribute('data-allowed'),
      ).toBe('false');
    }
  });
});

describe('RoleSettingsForm', () => {
  type Save = (
    input: unknown,
  ) => Promise<
    { ok: true; data: typeof ON } | { ok: false; error: { code: string; message: string } }
  >;

  function form({
    save = vi.fn<Save>((input) => {
      const { advocatesCanInvite, ownersSeeRestrictedMatters } = input as typeof ON;
      return Promise.resolve({
        ok: true,
        data: { advocatesCanInvite, ownersSeeRestrictedMatters },
      });
    }),
    canEdit = true,
  }: { save?: ReturnType<typeof vi.fn<Save>>; canEdit?: boolean } = {}) {
    withIntl(
      <RoleSettingsForm
        workspaceId={WORKSPACE_ID}
        settings={ON}
        canEdit={canEdit}
        save={save as never}
      />,
    );
    return { save };
  }

  const invite = () => screen.getByRole('switch', { name: en.settings.advocatesCanInvite.label });
  const restricted = () =>
    screen.getByRole('switch', { name: en.settings.ownersSeeRestrictedMatters.label });

  it('autosaves a change with an undo toast, and Undo sends the previous value back', async () => {
    const { save } = form();
    fireEvent.click(invite());
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(en.toast.saved, expect.anything());
    });
    expect(save).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      advocatesCanInvite: false,
      ownersSeeRestrictedMatters: true,
    });
    expect(invite().getAttribute('aria-checked')).toBe('false');

    const [, options] = toast.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(options.action.label).toBe(en.toast.undo);
    act(() => {
      options.action.onClick();
    });
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(en.toast.undone);
    });
    expect(save).toHaveBeenLastCalledWith({ workspaceId: WORKSPACE_ID, ...ON });
    expect(invite().getAttribute('aria-checked')).toBe('true');
  });

  it('rolls back and says so when the save fails', async () => {
    const save = vi.fn<Save>(() =>
      Promise.resolve({ ok: false, error: { code: 'FORBIDDEN', message: '' } }),
    );
    form({ save });
    fireEvent.click(restricted());
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(en.toast.forbidden);
    });
    expect(restricted().getAttribute('aria-checked')).toBe('true');
  });

  it('is read-only with a note for non-owners', () => {
    const { save } = form({ canEdit: false });
    expect(screen.getByText(en.settings.readOnly)).toBeTruthy();
    expect(invite().getAttribute('aria-readonly')).toBe('true');
    fireEvent.click(invite());
    expect(save).not.toHaveBeenCalled();
    expect(invite().getAttribute('aria-checked')).toBe('true');
  });

  it('is read-only offline', () => {
    setOnline(false);
    const { save } = form();
    expect(restricted().getAttribute('aria-readonly')).toBe('true');
    fireEvent.click(restricted());
    expect(save).not.toHaveBeenCalled();
  });
});

describe('MatterRestrictions', () => {
  it('shows the empty state and a disabled matter picker stub', () => {
    withIntl(<MatterRestrictions restrictions={[]} />);
    expect(document.querySelector('[data-pattern-state="empty"]')?.textContent).toContain(
      en.restricted.empty,
    );
    const picker = screen.getByRole('button', { name: en.restricted.picker });
    expect(picker.hasAttribute('disabled')).toBe(true);
  });

  it('lists restricted matters with their allowed members', () => {
    withIntl(
      <MatterRestrictions
        restrictions={[
          {
            matterId: '11111111-2222-4333-8444-555555555555',
            reason: 'Sealed cover',
            createdAt: '2026-10-01T10:00:00.000Z',
            allowedUsers: [
              { userId: 'u1', name: 'Asha Rao' },
              { userId: 'u2', name: 'Ravi Iyer' },
            ],
          },
          {
            matterId: '99999999-2222-4333-8444-555555555555',
            reason: null,
            createdAt: '2026-10-02T10:00:00.000Z',
            allowedUsers: [],
          },
        ]}
      />,
    );
    const items = document.querySelectorAll('[data-slot="restricted-list"] li');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Matter 11111111');
    expect(items[0]?.textContent).toContain('Sealed cover');
    expect(items[0]?.textContent).toContain('Asha Rao and Ravi Iyer');
    expect(items[1]?.textContent).toContain(en.restricted.ownersOnly);
  });
});

describe('roles page (server)', () => {
  /** Render the page, resolving the async section inside its Suspense boundary. */
  async function renderPage(search: Record<string, string> = {}) {
    const tree = (await RolesPage({
      params: Promise.resolve({ slug: 'demo' }),
      searchParams: Promise.resolve(search),
    })) as ReactElement<{ children: [ReactElement, ReactElement, ReactElement] }>;
    const [header, matrix, body] = tree.props.children;
    const section = (body.props as { children?: ReactElement }).children;
    let content: ReactNode = body;
    if (section && typeof section.type === 'function') {
      const Section = section.type as (props: unknown) => Promise<ReactNode>;
      content = await Section(section.props);
    }
    const Matrix = matrix.type as () => Promise<ReactNode>;
    withIntl(
      <div>
        {header}
        {await Matrix()}
        {content}
      </div>,
    );
  }

  it('loads the settings and restrictions on the workspace transaction', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.title);
    expect(runtime.inWorkspace).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', userId: 'user-1' },
      expect.any(Function),
    );
    expect(matters.listMatterRestrictions).toHaveBeenCalledWith(
      { tx: true },
      { workspaceId: 'ws-1', userId: 'user-1' },
    );
    // An owner can edit; the restricted list is empty.
    expect(screen.queryByText(en.settings.readOnly)).toBeNull();
    expect(document.querySelector('[data-pattern-state="empty"]')).not.toBeNull();
  });

  it('is read-only for an advocate', async () => {
    page.context = testWorkspaceContext('demo', 'advocate');
    await renderPage();
    expect(screen.getByText(en.settings.readOnly)).toBeTruthy();
  });

  it('shows the error state with Try again when loading fails', async () => {
    page.fail = true;
    await renderPage();
    expect(screen.getByRole('alert').textContent).toContain(en.error.title);
    fireEvent.click(screen.getByRole('button', { name: en.error.retry }));
    expect(router.refresh).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('is permission-denied for a viewer and not found for a non-member', async () => {
    page.context = testWorkspaceContext('demo', 'viewer');
    withIntl(
      (await RolesPage({
        params: Promise.resolve({ slug: 'demo' }),
        searchParams: Promise.resolve({}),
      })) as ReactElement,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      catalogs.en.shell.permissionDenied.title,
    );
    page.context = null;
    await expect(
      RolesPage({ params: Promise.resolve({ slug: 'demo' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
