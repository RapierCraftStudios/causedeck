// @vitest-environment jsdom
// Settings shell and workspace profile (#284): the sub-nav lists the eight sections plus usage and
// audit, hidden by `can()` per role; direct URLs to a hidden section show the permission-denied
// page; the profile form validates with zod, saves optimistically with rollback and toasts, keeps
// the slug rename owner-only, turns read-only offline, and guards unsaved changes.
import { readFileSync } from 'node:fs';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProfileView } from '../app/(app)/w/[slug]/settings/profile/actions.ts';
import type { Role, WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  dev: true,
  pathname: '/w/demo/settings/profile',
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => page.pathname,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => page.dev }));
vi.mock('../src/health.ts', () => ({ logger: { error: vi.fn() } }));
vi.mock('@causedeck/ui/sonner', () => ({ toast }));
vi.mock('../app/(app)/w/[slug]/settings/profile/actions.ts', () => ({
  updateWorkspaceProfileAction: vi.fn(),
}));

const nav = await import('../lib/settings-nav.ts');
const { default: SettingsLayout } = await import('../app/(app)/w/[slug]/settings/layout.tsx');
const { default: SettingsIndex } = await import('../app/(app)/w/[slug]/settings/page.tsx');
const { default: ProfilePage } = await import('../app/(app)/w/[slug]/settings/profile/page.tsx');
const { ProfileForm, renamedPath } =
  await import('../app/(app)/w/[slug]/settings/profile/profile-form.tsx');
const { UnsavedChangesGuard } = await import('../components/settings/unsaved-changes-guard.tsx');
const PLACEHOLDERS = {
  roles: (await import('../app/(app)/w/[slug]/settings/roles/page.tsx')).default,
  integrations: (await import('../app/(app)/w/[slug]/settings/integrations/page.tsx')).default,
  privacy: (await import('../app/(app)/w/[slug]/settings/privacy/page.tsx')).default,
  export: (await import('../app/(app)/w/[slug]/settings/export/page.tsx')).default,
  danger: (await import('../app/(app)/w/[slug]/settings/danger/page.tsx')).default,
};

const en = catalogs.en.settings;
const WORKSPACE_ID = '00000000-0000-4000-8000-00000000a001';
const PROFILE: ProfileView = {
  name: 'Demo Chambers',
  slug: 'demo',
  kind: 'solo',
  timezone: 'Asia/Kolkata',
  locale: 'en',
  practiceCity: null,
};

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

const asRole = (role: Role) => {
  page.context = testWorkspaceContext('demo', role);
};
const params = () => Promise.resolve({ slug: 'demo' });

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

beforeEach(() => {
  asRole('owner');
  page.dev = true;
  page.pathname = '/w/demo/settings/profile';
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('settings nav manifest', () => {
  const ids = (role: Role) => nav.visibleSettingsItems(role).map((item) => item.id);

  it('lists the eight sections in order, then usage and the audit log', () => {
    expect(nav.SETTINGS_NAV.filter((i) => i.group === 'sections').map((i) => i.id)).toEqual([
      'profile',
      'members',
      'roles',
      'notifications',
      'integrations',
      'privacy',
      'export',
      'danger',
    ]);
    expect(ids('owner')).toEqual([...nav.SETTINGS_SECTIONS, 'usage', 'audit']);
  });

  it('hides the sections a role cannot open', () => {
    expect(ids('advocate')).toEqual([
      'profile',
      'members',
      'roles',
      'notifications',
      'integrations',
      'privacy',
      'audit',
    ]);
    expect(ids('junior')).toEqual(['profile', 'members', 'roles', 'notifications']);
    expect(ids('clerk')).toEqual(['profile', 'members', 'roles', 'notifications']);
    expect(ids('viewer')).toEqual(['members', 'notifications']);
  });

  it('lands on the profile, or on members for a viewer', () => {
    expect(nav.settingsLanding('owner')).toBe('profile');
    expect(nav.settingsLanding('clerk')).toBe('profile');
    expect(nav.settingsLanding('viewer')).toBe('members');
  });

  it('finds the section of a pathname', () => {
    expect(nav.settingsItemFor('/w/demo/settings/privacy')?.id).toBe('privacy');
    expect(nav.settingsItemFor('/w/demo/settings/members/x')?.id).toBe('members');
    expect(nav.settingsItemFor('/w/demo/today')).toBeUndefined();
  });
});

describe('settings shell', () => {
  async function renderShell() {
    withIntl(await SettingsLayout({ children: <p>child page</p>, params: params() }));
  }

  it('redirects /settings to the first section the role may open', async () => {
    await expect(SettingsIndex({ params: params() })).rejects.toThrow(
      'NEXT_REDIRECT /w/demo/settings/profile',
    );
    asRole('viewer');
    await expect(SettingsIndex({ params: params() })).rejects.toThrow(
      'NEXT_REDIRECT /w/demo/settings/members',
    );
  });

  it('renders the header, a labelled sub-nav with every section for an owner, and the page', async () => {
    await renderShell();
    const navigation = screen.getByRole('navigation', { name: en.navLabel });
    const links = within(navigation).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      en.nav.profile,
      en.nav.members,
      en.nav.roles,
      en.nav.notifications,
      en.nav.integrations,
      en.nav.privacy,
      en.nav.export,
      en.nav.danger,
      en.nav.usage,
      en.nav.audit,
    ]);
    expect(links[0]?.getAttribute('href')).toBe('/w/demo/settings/profile');
    expect(links[0]?.getAttribute('aria-current')).toBe('page');
    expect(links[1]?.getAttribute('aria-current')).toBeNull();
    expect(screen.getByText(en.title)).toBeTruthy();
    expect(screen.getByText('child page')).toBeTruthy();
  });

  it('hides owner-only and advocate-only sections from a clerk', async () => {
    asRole('clerk');
    await renderShell();
    const navigation = screen.getByRole('navigation', { name: en.navLabel });
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([en.nav.profile, en.nav.members, en.nav.roles, en.nav.notifications]);
  });

  it('shows the offline banner while offline', async () => {
    await renderShell();
    expect(screen.queryByText(en.offline)).toBeNull();
    act(() => {
      setOnline(false);
    });
    expect(screen.getByText(en.offline)).toBeTruthy();
  });

  it('is not found for a non-member', async () => {
    page.context = null;
    await expect(SettingsLayout({ children: null, params: params() })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});

describe('section pages', () => {
  const denied = catalogs.en.shell.permissionDenied.title;

  it.each([
    ['clerk', 'integrations'],
    ['clerk', 'privacy'],
    ['advocate', 'export'],
    ['advocate', 'danger'],
    ['viewer', 'roles'],
  ] as const)('a %s opening %s directly gets the permission-denied page', async (role, id) => {
    asRole(role);
    withIntl(await PLACEHOLDERS[id]({ params: params() }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(denied);
  });

  it.each(Object.keys(PLACEHOLDERS) as (keyof typeof PLACEHOLDERS)[])(
    '%s renders inside the shell for an owner',
    async (id) => {
      withIntl(await PLACEHOLDERS[id]({ params: params() }));
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.nav[id]);
      expect(document.querySelector(`[data-route="settings-${id}"]`)).not.toBeNull();
    },
  );

  it('danger lists transfer and delete, disabled with an explanation', async () => {
    withIntl(await PLACEHOLDERS.danger({ params: params() }));
    const zone = document.querySelector('[data-slot="danger-zone"]');
    expect(zone).not.toBeNull();
    for (const name of [en.danger.transfer.action, en.danger.delete.action]) {
      const button = screen.getByRole('button', { name });
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(button.getAttribute('title')).toBe(en.danger.unavailable);
    }
  });

  it('profile is permission-denied for a viewer and previews loading in development', async () => {
    asRole('viewer');
    withIntl(await ProfilePage({ params: params(), searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(denied);
    cleanup();
    asRole('clerk');
    withIntl(
      await ProfilePage({
        params: params(),
        searchParams: Promise.resolve({ __state: 'loading' }),
      }),
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.profile.title);
    expect(document.querySelector('[data-pattern-state="loading"]')).not.toBeNull();
  });
});

describe('ProfileForm', () => {
  type Save = (
    input: unknown,
  ) => Promise<
    { ok: true; data: ProfileView } | { ok: false; error: { code: string; message: string } }
  >;

  function form({
    save = vi.fn<Save>((input) =>
      Promise.resolve({ ok: true, data: { ...PROFILE, ...(input as Partial<ProfileView>) } }),
    ),
    canEdit = true,
    canRename = true,
  }: { save?: ReturnType<typeof vi.fn<Save>>; canEdit?: boolean; canRename?: boolean } = {}) {
    withIntl(
      <ProfileForm
        workspaceId={WORKSPACE_ID}
        profile={PROFILE}
        canEdit={canEdit}
        canRename={canRename}
        save={save as never}
      />,
    );
    return { save };
  }

  const nameInput = () => screen.getByRole('textbox', { name: en.profile.name });
  const saveButton = () => screen.getByRole('button', { name: en.profile.save });

  it('enables Save changes only when dirty and saves the trimmed values with a toast', async () => {
    const { save } = form();
    expect(saveButton().hasAttribute('disabled')).toBe(true);
    fireEvent.change(nameInput(), { target: { value: '  Iyer Chambers ' } });
    fireEvent.change(screen.getByRole('textbox', { name: en.profile.practiceCity }), {
      target: { value: 'Chennai' },
    });
    expect(saveButton().hasAttribute('disabled')).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(en.profile.toast.saved);
    });
    expect(save).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      name: 'Iyer Chambers',
      kind: 'solo',
      timezone: 'Asia/Kolkata',
      locale: 'en',
      practiceCity: 'Chennai',
    });
    expect(nameInput()).toHaveProperty('value', 'Iyer Chambers');
    expect(saveButton().hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('status').textContent).toContain(en.profile.saved);
  });

  it('validates with zod before sending', () => {
    const { save } = form();
    fireEvent.change(nameInput(), { target: { value: '   ' } });
    fireEvent.click(saveButton());
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(en.profile.errors.name)).toBeTruthy();
  });

  it('shows Saving while pending and rolls back with a toast when the save fails', async () => {
    let resolve: (value: Awaited<ReturnType<Save>>) => void = () => undefined;
    const save = vi.fn<Save>(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    form({ save });
    fireEvent.change(nameInput(), { target: { value: 'Iyer Chambers' } });
    fireEvent.click(saveButton());
    // Optimistic: the change is applied, so the form is no longer dirty while saving.
    expect(screen.getByRole('status').textContent).toContain(en.profile.saving);
    expect(saveButton().hasAttribute('disabled')).toBe(true);
    await act(async () => {
      resolve({ ok: false, error: { code: 'INTERNAL', message: '' } });
      await Promise.resolve();
    });
    expect(toast).toHaveBeenCalledWith(en.profile.errors.generic);
    // Rolled back: the edit is unsaved again.
    expect(saveButton().hasAttribute('disabled')).toBe(false);
    expect(document.querySelector('[data-slot="profile-form"]')?.hasAttribute('data-dirty')).toBe(
      true,
    );
  });

  it('says FORBIDDEN in a toast', async () => {
    form({
      save: vi.fn<Save>(() =>
        Promise.resolve({ ok: false, error: { code: 'FORBIDDEN', message: '' } }),
      ),
    });
    fireEvent.change(nameInput(), { target: { value: 'Iyer Chambers' } });
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(en.profile.errors.forbidden);
    });
  });

  it('lets an owner rename the slug and moves to the new address', async () => {
    const { save } = form();
    fireEvent.click(screen.getByRole('button', { name: en.profile.rename }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: en.profile.newSlug }), {
      target: { value: 'iyer-chambers' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.profile.renameConfirm }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalled();
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        name: 'Demo Chambers',
        slug: 'iyer-chambers',
      }),
    );
    expect(toast).toHaveBeenCalledWith('Web address changed to iyer-chambers.');
  });

  it('rejects an invalid new slug in the dialog and shows a taken slug from the server', async () => {
    const save = vi.fn<Save>(() =>
      Promise.resolve({ ok: false, error: { code: 'CONFLICT', message: 'This slug is taken' } }),
    );
    form({ save });
    fireEvent.click(screen.getByRole('button', { name: en.profile.rename }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('textbox', { name: en.profile.newSlug });
    fireEvent.change(input, { target: { value: 'settings' } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.profile.renameConfirm }));
    expect(within(dialog).getByText(en.profile.errors.slug)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'taken-one' } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.profile.renameConfirm }));
    await waitFor(() => {
      expect(within(dialog).getByText(en.profile.errors.slugTaken)).toBeTruthy();
    });
    expect(document.querySelector('[data-slot="workspace-slug"]')?.textContent).toBe('demo');
  });

  it('shows the slug read-only with the owner-only note to non-owners', () => {
    form({ canRename: false });
    expect(screen.queryByRole('button', { name: en.profile.rename })).toBeNull();
    expect(screen.getByText(en.profile.ownerOnly)).toBeTruthy();
    expect(document.querySelector('[data-slot="workspace-slug"]')?.textContent).toBe('demo');
  });

  it('is read-only without workspace.manage', () => {
    form({ canEdit: false, canRename: false });
    expect(nameInput().hasAttribute('readonly')).toBe(true);
    expect(screen.queryByRole('button', { name: en.profile.save })).toBeNull();
    expect(screen.getByText(en.profile.readOnly)).toBeTruthy();
  });

  it('is read-only offline', () => {
    form();
    act(() => {
      setOnline(false);
    });
    expect(nameInput().hasAttribute('readonly')).toBe(true);
    expect(saveButton().hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: en.profile.rename }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('guards unsaved edits on tab close', () => {
    form();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.change(nameInput(), { target: { value: 'Iyer Chambers' } });
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('maps the current path onto the new slug', () => {
    expect(renamedPath('/w/demo/settings/profile', 'demo', 'iyer')).toBe(
      '/w/iyer/settings/profile',
    );
    expect(renamedPath('/elsewhere', 'demo', 'iyer')).toBe('/w/iyer/settings/profile');
  });
});

describe('UnsavedChangesGuard', () => {
  function guarded(dirty: boolean) {
    withIntl(
      <div>
        <a href="/w/demo/settings/members">Members</a>
        <a href="#main">Skip</a>
        <UnsavedChangesGuard dirty={dirty} />
      </div>,
    );
  }

  it('lets links through when the form is clean', () => {
    guarded(false);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole('link', { name: 'Members' }).dispatchEvent(click);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('holds an in-app link while dirty and asks; Leave follows it, Stay does not', async () => {
    guarded(true);
    fireEvent.click(screen.getByRole('link', { name: 'Members' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(en.unsaved.title)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsaved.stay }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(router.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('link', { name: 'Members' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: en.unsaved.leave,
      }),
    );
    expect(router.push).toHaveBeenCalledWith('/w/demo/settings/members');
  });

  it('ignores in-page anchors', () => {
    guarded(true);
    fireEvent.click(screen.getByRole('link', { name: 'Skip' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('settings dialogs stay out of the page bundle', () => {
  // Route JS budget (P7): the rename and unsaved-changes dialogs load with `next/dynamic`.
  const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

  it.each([
    [
      '../app/(app)/w/[slug]/settings/profile/profile-form.tsx',
      '@causedeck/ui/dialog',
      './rename-slug-dialog.tsx',
    ],
    [
      '../components/settings/unsaved-changes-guard.tsx',
      '@causedeck/ui/alert-dialog',
      './unsaved-changes-dialog.tsx',
    ],
  ])('%s imports its dialog lazily', (file, primitive, lazyModule) => {
    const text = source(file);
    expect(text).not.toContain(`from '${primitive}'`);
    expect(text).toContain(`import('${lazyModule}')`);
  });
});
