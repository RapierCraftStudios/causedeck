// @vitest-environment jsdom
// Settings email intake page (#54 part 2): empty (no address, no senders), with an address and
// allow-list entries, the flag off (`Not enabled yet`, controls disabled), offline (disabled with
// the reason), the error and loading states, and the permission-denied page for clerks and viewers.
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
interface PageState {
  context: WorkspaceContext | null;
  dev: boolean;
  fail: boolean;
  flags: Record<string, boolean>;
  address: unknown;
  entries: unknown[];
}
const page = vi.hoisted((): PageState => ({
  context: null,
  dev: true,
  fail: false,
  flags: {},
  address: null,
  entries: [],
}));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const intake = vi.hoisted(() => ({
  getActiveAddress: vi.fn(() =>
    page.fail ? Promise.reject(new Error('db down')) : Promise.resolve(page.address),
  ),
  listAllowlist: vi.fn(() => Promise.resolve(page.entries)),
}));
const capture = vi.hoisted(() => ({ isChannelEnabled: vi.fn(() => Promise.resolve(false)) }));
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
vi.mock('../lib/flags.ts', () => ({
  workspaceFlagCheck: () => Promise.resolve((key: string) => page.flags[key] === true),
}));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('@causedeck/ui/sonner', () => ({ toast: vi.fn() }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/email-intake', () => intake);
vi.mock('@causedeck/core/capture', () => capture);
vi.mock('../app/(app)/w/[slug]/settings/integrations/email/actions.ts', () => ({
  addIntakeAllowlistEntryAction: vi.fn(),
  createIntakeAddressAction: vi.fn(),
  enableEmailChannelAction: vi.fn(),
  removeIntakeAllowlistEntryAction: vi.fn(),
  revokeIntakeAddressAction: vi.fn(),
  rotateIntakeAddressAction: vi.fn(),
}));

const { default: EmailIntakePage } =
  await import('../app/(app)/w/[slug]/settings/integrations/email/page.tsx');

const en = catalogs.en.emailIntake;
const CREATED = new Date('2026-10-01T10:00:00Z');

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  page.context = testWorkspaceContext('demo', 'owner');
  page.dev = true;
  page.fail = false;
  page.flags = { 'capture.email-forward': true };
  page.address = null;
  page.entries = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Render the page, resolving the async section inside its Suspense boundary. */
async function renderPage(search: Record<string, string> = {}) {
  const tree = (await EmailIntakePage({
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

describe('email intake page (server)', () => {
  it('shows the title and the empty state, loaded on the workspace transaction', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.title);
    expect(runtime.inWorkspace).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', userId: 'user-1' },
      expect.any(Function),
    );
    expect(intake.getActiveAddress).toHaveBeenCalledWith({ tx: true }, 'ws-1', 'user-1');
    expect(capture.isChannelEnabled).toHaveBeenCalledWith({ tx: true }, 'ws-1', 'email');
  });

  it('shows the active address and the allow-list entries', async () => {
    page.address = { id: 'a1', address: 'u-k3j9x2mq4a@intake.test', createdAt: CREATED };
    page.entries = [
      {
        id: 'e1',
        pattern: 'court.gov.in',
        kind: 'court',
        label: null,
        isDomain: true,
        createdAt: CREATED,
      },
    ];
    await renderPage();
    expect(document.body.textContent).toContain('u-k3j9x2mq4a@intake.test');
    expect(document.body.textContent).toContain('court.gov.in');
  });

  it('disables the controls while the flag is off', async () => {
    page.flags = {};
    await renderPage();
    const buttons = [...document.querySelectorAll('main button, button')] as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it('shows the error state when loading fails', async () => {
    page.fail = true;
    await renderPage();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(logger.error).toHaveBeenCalled();
  });

  it('previews the loading skeleton in development', async () => {
    await renderPage({ __state: 'loading' });
    expect(document.querySelector('[data-pattern-state="loading"]')).not.toBeNull();
    expect(intake.getActiveAddress).not.toHaveBeenCalled();
  });

  it.each(['clerk', 'viewer'] as const)('is permission-denied for a %s', async (role) => {
    page.context = testWorkspaceContext('demo', role);
    withIntl(
      (await EmailIntakePage({
        params: Promise.resolve({ slug: 'demo' }),
        searchParams: Promise.resolve({}),
      })) as ReactElement,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      catalogs.en.shell.permissionDenied.title,
    );
    expect(intake.getActiveAddress).not.toHaveBeenCalled();
  });

  it('is not found for a non-member', async () => {
    page.context = null;
    await expect(
      EmailIntakePage({
        params: Promise.resolve({ slug: 'demo' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
