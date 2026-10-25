// @vitest-environment jsdom
// Settings privacy page (#286): the summary card leads; India-only AI processing is on, disabled and
// explained, with no control that turns it off; the sensitive-matter default autosaves with an undo
// toast for owners and advocates, rolls back on failure and is read-only for everyone else and
// offline; the retention window offers 7, 14 and 30 days; the sub-processor link and the
// `What CauseDeck never does` list follow; a load failure shows the error state with `Try again`.
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
  getPrivacySettings: vi.fn(() =>
    page.fail
      ? Promise.reject(new Error('db down'))
      : Promise.resolve({
          indiaOnlyAi: true,
          sensitiveDefaultRestricted: true,
          retentionAudioDays: 30,
          contributePublicCourtDocuments: false,
        }),
  ),
}));
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
vi.mock('../app/(app)/w/[slug]/settings/privacy/actions.ts', () => ({
  updateWorkspacePrivacyAction: vi.fn(),
}));

const { default: PrivacyPage } = await import('../app/(app)/w/[slug]/settings/privacy/page.tsx');
const { PrivacyForm } = await import('../app/(app)/w/[slug]/settings/privacy/privacy-form.tsx');

const en = catalogs.en.settings.privacy;
const WORKSPACE_ID = '00000000-0000-4000-8000-00000000a001';
const DEFAULTS = {
  indiaOnlyAi: true,
  sensitiveDefaultRestricted: true,
  retentionAudioDays: 30,
  contributePublicCourtDocuments: false,
};

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

const indiaOnly = () => screen.getByRole('switch', { name: en.indiaOnly.label });
const sensitive = () =>
  screen.getByRole('switch', { name: en.settings.sensitiveDefaultRestricted.label });
const retention = () =>
  screen.getByRole('combobox', { name: en.settings.retentionAudioDays.label });

describe('PrivacyForm', () => {
  type Save = (
    input: unknown,
  ) => Promise<
    { ok: true; data: typeof DEFAULTS } | { ok: false; error: { code: string; message: string } }
  >;

  function form({
    save = vi.fn<Save>((input) => {
      const { sensitiveDefaultRestricted, retentionAudioDays, contributePublicCourtDocuments } =
        input as typeof DEFAULTS;
      return Promise.resolve({
        ok: true,
        data: {
          indiaOnlyAi: true,
          sensitiveDefaultRestricted,
          retentionAudioDays,
          contributePublicCourtDocuments,
        },
      });
    }),
    canEdit = true,
  }: { save?: ReturnType<typeof vi.fn<Save>>; canEdit?: boolean } = {}) {
    withIntl(
      <PrivacyForm
        workspaceId={WORKSPACE_ID}
        settings={DEFAULTS as never}
        canEdit={canEdit}
        save={save as never}
      />,
    );
    return { save };
  }

  it('shows India-only AI on, locked and explained, and clicking it saves nothing', () => {
    const { save } = form();
    const ai = indiaOnly();
    expect(ai.getAttribute('aria-checked')).toBe('true');
    expect(ai.hasAttribute('disabled')).toBe(true);
    const describedBy = ai.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe(en.indiaOnly.description);
    expect(document.querySelector('[data-slot="india-only-locked"]')?.textContent).toContain(
      en.indiaOnly.locked,
    );
    expect(screen.getByText(en.indiaOnly.note)).toBeTruthy();
    fireEvent.click(ai);
    expect(save).not.toHaveBeenCalled();
    expect(ai.getAttribute('aria-checked')).toBe('true');
  });

  it('offers no control other than the three settings, so nothing can turn India-only AI off', () => {
    form();
    expect(screen.getAllByRole('switch')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /override/i })).toBeNull();
  });

  it('autosaves the sensitive default with an undo toast, and Undo sends the previous value back', async () => {
    const { save } = form();
    fireEvent.click(sensitive());
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(en.toast.saved, expect.anything());
    });
    expect(save).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      sensitiveDefaultRestricted: false,
      retentionAudioDays: 30,
      contributePublicCourtDocuments: false,
    });
    expect(sensitive().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('status').textContent).toContain(en.saved);

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
    expect(save).toHaveBeenLastCalledWith({
      workspaceId: WORKSPACE_ID,
      sensitiveDefaultRestricted: true,
      retentionAudioDays: 30,
      contributePublicCourtDocuments: false,
    });
    expect(sensitive().getAttribute('aria-checked')).toBe('true');
  });

  it('explains court document sharing and saves the opt-in (off by default)', async () => {
    const { save } = form();
    const sharing = screen.getByRole('switch', {
      name: en.settings.contributePublicCourtDocuments.label,
    });
    expect(sharing.getAttribute('aria-checked')).toBe('false');
    const describedBy = sharing.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe(
      en.settings.contributePublicCourtDocuments.description,
    );
    fireEvent.click(sharing);
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_ID,
        sensitiveDefaultRestricted: true,
        retentionAudioDays: 30,
        contributePublicCourtDocuments: true,
      });
    });
  });

  it('rolls back and says so when the save fails', async () => {
    const save = vi.fn<Save>(() =>
      Promise.resolve({ ok: false, error: { code: 'FORBIDDEN', message: '' } }),
    );
    form({ save });
    fireEvent.click(sensitive());
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(en.toast.forbidden);
    });
    expect(sensitive().getAttribute('aria-checked')).toBe('true');
  });

  it('shows the 30 day retention window, labelled and described', () => {
    form();
    const select = retention();
    expect(select.textContent).toBe('30 days');
    const describedBy = select.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe(
      en.settings.retentionAudioDays.description,
    );
    expect(select.hasAttribute('disabled')).toBe(false);
  });

  it('is read-only with a note for members who cannot change it', () => {
    const { save } = form({ canEdit: false });
    expect(screen.getByText(en.settings.readOnly)).toBeTruthy();
    expect(sensitive().getAttribute('aria-readonly')).toBe('true');
    expect(retention().hasAttribute('disabled')).toBe(true);
    fireEvent.click(sensitive());
    expect(save).not.toHaveBeenCalled();
    expect(sensitive().getAttribute('aria-checked')).toBe('true');
  });

  it('is read-only offline', () => {
    setOnline(false);
    const { save } = form();
    expect(sensitive().getAttribute('aria-readonly')).toBe('true');
    expect(retention().hasAttribute('disabled')).toBe(true);
    fireEvent.click(sensitive());
    expect(save).not.toHaveBeenCalled();
  });
});

describe('privacy page (server)', () => {
  /** Render the page, resolving the async section inside its Suspense boundary. */
  async function renderPage(search: Record<string, string> = {}) {
    const tree = (await PrivacyPage({
      params: Promise.resolve({ slug: 'demo' }),
      searchParams: Promise.resolve(search),
    })) as ReactElement<{ children: ReactElement[] }>;
    const children = await Promise.all(
      tree.props.children.map(async (child) => {
        const section = (child.props as { children?: ReactElement }).children;
        if (section && typeof section === 'object' && typeof section.type === 'function') {
          const Section = section.type as (props: unknown) => Promise<ReactNode>;
          if (Section.constructor.name === 'AsyncFunction') return Section(section.props);
        }
        return child;
      }),
    );
    withIntl(<div>{children}</div>);
  }

  it('leads with the summary card and loads the settings on the workspace transaction', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.title);
    expect(document.querySelector('[data-slot="privacy-summary"]')?.textContent).toBe(
      'Your data stays in India. AI processing stays in India. We never train on your content.',
    );
    expect(runtime.inWorkspace).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', userId: 'user-1' },
      expect.any(Function),
    );
    expect(workspaces.getPrivacySettings).toHaveBeenCalledWith({ tx: true }, 'ws-1');
    expect(indiaOnly().getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText(en.settings.readOnly)).toBeNull();
  });

  it('links to the sub-processor list and lists what CauseDeck never does', async () => {
    await renderPage();
    expect(screen.getByRole('link', { name: en.subProcessors.link }).getAttribute('href')).toBe(
      '/legal/sub-processors',
    );
    expect(screen.getByRole('heading', { name: 'What CauseDeck never does' })).toBeTruthy();
    const items = document.querySelectorAll('[data-slot="privacy-never-does"] li');
    expect([...items].map((item) => item.textContent)).toEqual(Object.values(en.neverDoes.items));
  });

  it('lets an advocate edit', async () => {
    page.context = testWorkspaceContext('demo', 'advocate');
    await renderPage();
    expect(screen.queryByText(en.settings.readOnly)).toBeNull();
    expect(sensitive().getAttribute('aria-readonly')).not.toBe('true');
  });

  it('shows the error state with Try again when loading fails', async () => {
    page.fail = true;
    await renderPage();
    expect(screen.getByRole('alert').textContent).toContain(en.error.title);
    fireEvent.click(screen.getByRole('button', { name: en.error.retry }));
    expect(router.refresh).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('previews the loading skeleton in development', async () => {
    await renderPage({ __state: 'loading' });
    expect(document.querySelector('[data-pattern-state="loading"]')).not.toBeNull();
    expect(workspaces.getPrivacySettings).not.toHaveBeenCalled();
  });

  it.each(['clerk', 'viewer'] as const)('is permission-denied for a %s', async (role) => {
    page.context = testWorkspaceContext('demo', role);
    withIntl(
      (await PrivacyPage({
        params: Promise.resolve({ slug: 'demo' }),
        searchParams: Promise.resolve({}),
      })) as ReactElement,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      catalogs.en.shell.permissionDenied.title,
    );
    expect(workspaces.getPrivacySettings).not.toHaveBeenCalled();
  });

  it('is not found for a non-member', async () => {
    page.context = null;
    await expect(
      PrivacyPage({ params: Promise.resolve({ slug: 'demo' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
