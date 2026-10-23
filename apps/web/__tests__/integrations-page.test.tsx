// @vitest-environment jsdom
// Settings integrations page (#287): the ICS feed card shows a masked placeholder (only the token
// hash is stored) with the token status and a link card leads to the email intake page; `Create`
// makes the first token at once and `Rotate` asks first; the full value is then shown once with
// `Copy`; the card reads `Not enabled yet` and cannot rotate while its flag is off; offline the
// buttons are disabled with the reason; a failed rotate changes nothing; a load failure shows the
// error state with `Try again`; clerks and viewers get the permission-denied page.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
interface PageState {
  context: WorkspaceContext | null;
  dev: boolean;
  fail: boolean;
  flags: Record<string, boolean>;
  statuses: Record<string, unknown>;
}

const page = vi.hoisted((): PageState => ({
  context: null,
  dev: true,
  fail: false,
  flags: {},
  statuses: { ics_feed: null },
}));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const workspaces = vi.hoisted(() => ({
  getIntegrations: vi.fn(() =>
    page.fail ? Promise.reject(new Error('db down')) : Promise.resolve(page.statuses),
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
vi.mock('../lib/env.ts', () => ({
  isDev: () => page.dev,
  serverEnv: () => ({ APP_URL: 'https://app.causedeck.test' }),
}));
vi.mock('../lib/flags.ts', () => ({
  workspaceFlagCheck: () => Promise.resolve((key: string) => page.flags[key] === true),
}));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('@causedeck/ui/sonner', () => ({ toast }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/workspaces', () => workspaces);
vi.mock('../app/(app)/w/[slug]/settings/integrations/actions.ts', () => ({
  rotateIntegrationTokenAction: vi.fn(),
}));

const { default: IntegrationsPage } =
  await import('../app/(app)/w/[slug]/settings/integrations/page.tsx');
const { IntegrationCard } =
  await import('../app/(app)/w/[slug]/settings/integrations/integration-card.tsx');

const en = catalogs.en.settings.integrations;
const WORKSPACE_ID = '00000000-0000-4000-8000-00000000a001';
const MASKED_FEED = 'https://app.causedeck.test/api/ics/••••••••';
const FEED = 'https://app.causedeck.test/api/ics/tok_new';
const CREATED = new Date('2026-10-01T10:00:00Z');
const ROTATED = new Date('2026-10-20T10:00:00Z');

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

const clipboard = { writeText: vi.fn(() => Promise.resolve()) };

beforeEach(() => {
  page.context = testWorkspaceContext('demo', 'owner');
  page.dev = true;
  page.fail = false;
  page.flags = { 'capture.email-forward': true, 'capture.ics-feed': true };
  page.statuses = { ics_feed: null };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const value = (kind: string) =>
  document.querySelector<HTMLInputElement>(`[data-slot="integration-${kind}"] input`);
const actionButton = (kind: string) =>
  document.querySelector<HTMLButtonElement>(
    `[data-slot="integration-${kind}"] [data-slot="integration-rotate"]`,
  );

describe('IntegrationCard', () => {
  type Rotate = (
    input: unknown,
  ) => Promise<
    | { ok: true; data: { kind: string; value: string; createdAt: Date; rotatedAt: Date | null } }
    | { ok: false; error: { code: string; message: string } }
  >;

  function card({
    status = null as { createdAt: Date; rotatedAt: Date | null } | null,
    enabled = true,
    rotate = vi.fn<Rotate>(() =>
      Promise.resolve({
        ok: true,
        data: {
          kind: 'ics_feed',
          value: FEED,
          createdAt: CREATED,
          rotatedAt: status ? ROTATED : null,
        },
      }),
    ),
  } = {}) {
    withIntl(
      <IntegrationCard
        workspaceId={WORKSPACE_ID}
        kind="ics_feed"
        masked={MASKED_FEED}
        status={status}
        enabled={enabled}
        rotate={rotate as never}
      />,
    );
    return { rotate };
  }

  it('creates the first token at once and shows the full value once with Copy', async () => {
    const { rotate } = card();
    expect(screen.getByText(en.notCreated)).toBeTruthy();
    expect(value('ics_feed')?.value).toBe(MASKED_FEED);
    fireEvent.click(screen.getByRole('button', { name: en.create }));
    await waitFor(() => {
      expect(value('ics_feed')?.value).toBe(FEED);
    });
    expect(rotate).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID, kind: 'ics_feed' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText(en.shownOnce)).toBeTruthy();
    expect(toast).toHaveBeenCalledWith(en.toast.created);
    expect(screen.getByText(/^Created on Oct 1, 2026\.$/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: en.copy }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: en.copied })).toBeTruthy();
    });
    expect(clipboard.writeText).toHaveBeenCalledWith(FEED);
    expect(screen.getByRole('status').textContent).toBe(en.copied);
  });

  it('asks before rotating, then replaces the token and shows the new value once', async () => {
    const { rotate } = card({ status: { createdAt: CREATED, rotatedAt: null } });
    expect(screen.getByText(/^Created on Oct 1, 2026\.$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.rotate }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(en.icsFeed.rotateTitle);
    expect(dialog.textContent).toContain(en.icsFeed.rotateBody);
    expect(rotate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en.rotateConfirm, hidden: false }));
    await waitFor(() => {
      expect(value('ics_feed')?.value).toBe(FEED);
    });
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText(/^Last rotated on Oct 20, 2026\.$/)).toBeTruthy();
    expect(toast).toHaveBeenCalledWith(en.toast.rotated);
  });

  it('cancelling the rotate dialog changes nothing', async () => {
    const { rotate } = card({ status: { createdAt: CREATED, rotatedAt: null } });
    fireEvent.click(screen.getByRole('button', { name: en.rotate }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: en.rotateCancel }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(rotate).not.toHaveBeenCalled();
    expect(value('ics_feed')?.value).toBe(MASKED_FEED);
  });

  it('keeps the placeholder and says so when the rotate fails', async () => {
    const rotate = vi.fn<Rotate>(() =>
      Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'x' } }),
    );
    card({ rotate });
    fireEvent.click(screen.getByRole('button', { name: en.create }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(en.toast.error);
    });
    expect(value('ics_feed')?.value).toBe(MASKED_FEED);
    expect(screen.queryByText(en.shownOnce)).toBeNull();
    expect(screen.getByText(en.notCreated)).toBeTruthy();
  });

  it('reads Not enabled yet and cannot rotate while the flag is off', () => {
    const { rotate } = card({ enabled: false });
    expect(document.querySelector('[data-slot="integration-not-enabled"]')?.textContent).toBe(
      en.notEnabled,
    );
    const button = actionButton('ics_feed');
    expect(button?.disabled).toBe(true);
    expect(
      document
        .querySelector('[data-slot="disabled-with-reason"]')
        ?.getAttribute('data-disabled-reason'),
    ).toBe(en.notEnabledReason);
    if (button) fireEvent.click(button);
    expect(rotate).not.toHaveBeenCalled();
  });

  it('is read-only offline with the reason', () => {
    setOnline(false);
    const { rotate } = card();
    expect(actionButton('ics_feed')?.disabled).toBe(true);
    expect(
      document
        .querySelector('[data-slot="disabled-with-reason"]')
        ?.getAttribute('data-disabled-reason'),
    ).toBe('Settings can be changed when you are back online.');
    expect(rotate).not.toHaveBeenCalled();
  });
});

describe('integrations page (server)', () => {
  /** Render the page, resolving the async section inside its Suspense boundary. */
  async function renderPage(search: Record<string, string> = {}) {
    const tree = (await IntegrationsPage({
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

  it('shows the email link card and the feed card with masked placeholders, loaded on the workspace transaction', async () => {
    page.statuses = { ics_feed: null };
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.title);
    expect(runtime.inWorkspace).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', userId: 'user-1' },
      expect.any(Function),
    );
    expect(workspaces.getIntegrations).toHaveBeenCalledWith({ tx: true }, 'ws-1');
    expect(screen.getByRole('heading', { name: en.emailIntake.title })).toBeTruthy();
    expect(screen.getByRole('link', { name: en.emailIntake.open }).getAttribute('href')).toBe(
      '/w/demo/settings/integrations/email',
    );
    expect(screen.getByRole('heading', { name: en.icsFeed.title })).toBeTruthy();
    expect(value('ics_feed')?.value).toBe(MASKED_FEED);
    expect(actionButton('ics_feed')?.textContent).toBe(en.create);
    expect(document.querySelector('[data-slot="integration-not-enabled"]')).toBeNull();
  });

  it('shows Not enabled yet per card whose flag is off', async () => {
    page.flags = { 'capture.email-forward': true, 'capture.ics-feed': false };
    await renderPage();
    expect(
      document.querySelector(
        '[data-slot="integration-ics_feed"] [data-slot="integration-not-enabled"]',
      )?.textContent,
    ).toBe(en.notEnabled);
    expect(actionButton('ics_feed')?.disabled).toBe(true);
  });

  it('lets an advocate rotate', async () => {
    page.context = testWorkspaceContext('demo', 'advocate');
    await renderPage();
    expect(actionButton('ics_feed')?.disabled).toBe(false);
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
    expect(workspaces.getIntegrations).not.toHaveBeenCalled();
  });

  it.each(['clerk', 'viewer'] as const)('is permission-denied for a %s', async (role) => {
    page.context = testWorkspaceContext('demo', role);
    withIntl(
      (await IntegrationsPage({
        params: Promise.resolve({ slug: 'demo' }),
        searchParams: Promise.resolve({}),
      })) as ReactElement,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      catalogs.en.shell.permissionDenied.title,
    );
    expect(workspaces.getIntegrations).not.toHaveBeenCalled();
  });

  it('is not found for a non-member', async () => {
    page.context = null;
    await expect(
      IntegrationsPage({
        params: Promise.resolve({ slug: 'demo' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
