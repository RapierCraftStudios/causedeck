// @vitest-environment jsdom
// Courts index page (#399): every role, clerk and viewer included, reads the index from
// `getCourtsIndex` in its own workspace scope; a FORBIDDEN from core renders permission-denied; any
// other failure shows `Could not load courts.` with `Try again`; no forums shows the empty state;
// offline shows `Showing saved court information`; `?__state=loading` previews the skeleton in dev.
// The route's loading.tsx and error.tsx boundaries are covered too.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CourtsIndex } from '@causedeck/core/court';

import { sampleIndex } from '../components/courts/__tests__/fixtures.ts';
import type { Role, WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  dev: true,
  index: null as CourtsIndex | null,
  error: null as Error | null,
}));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const court = vi.hoisted(() => ({
  getCourtsIndex: vi.fn<(tx: unknown, workspaceId: string) => Promise<CourtsIndex | null>>(() =>
    page.error === null ? Promise.resolve(page.index) : Promise.reject(page.error),
  ),
}));
const logger = vi.hoisted(() => ({ error: vi.fn() }));
const reportError = vi.hoisted(() => vi.fn());

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
vi.mock('../lib/report-error.ts', () => ({ reportError }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/court', () => court);

const { default: CourtsPage } = await import('../app/(app)/w/[slug]/courts/page.tsx');
const { default: CourtsLoading } = await import('../app/(app)/w/[slug]/courts/loading.tsx');
const { default: CourtsError } = await import('../app/(app)/w/[slug]/courts/error.tsx');

const en = catalogs.en.courts;

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

const props = (query: Record<string, string> = {}) => ({
  params: Promise.resolve({ slug: 'demo' }),
  searchParams: Promise.resolve(query),
});

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

class WorkspaceError extends Error {
  override name = 'WorkspaceError';
  constructor(readonly code: string) {
    super(code);
  }
}

beforeEach(() => {
  page.context = testWorkspaceContext('demo', 'owner');
  page.dev = true;
  page.index = sampleIndex();
  page.error = null;
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('courts page (#399)', () => {
  it.each(['owner', 'advocate', 'clerk', 'viewer'] satisfies Role[])(
    'shows the index to a %s, read in its own workspace',
    async (role) => {
      page.context = testWorkspaceContext('demo', role);
      withIntl(await CourtsPage(props()));
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.title);
      expect(screen.getByRole('grid')).toBeTruthy();
      expect(runtime.inWorkspace).toHaveBeenCalledWith(
        { workspaceId: 'ws-1', userId: 'user-1' },
        expect.any(Function),
      );
      expect(court.getCourtsIndex).toHaveBeenCalledWith({ tx: true }, 'ws-1');
      expect(document.querySelector('[data-pattern-state="permission-denied"]')).toBeNull();
    },
  );

  it('renders permission-denied when core refuses access', async () => {
    page.error = new WorkspaceError('FORBIDDEN');
    withIntl(await CourtsPage(props()));
    expect(document.querySelector('[data-pattern-state="permission-denied"]')).not.toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('shows the error state with Try again when loading fails', async () => {
    page.error = new Error('db down');
    withIntl(await CourtsPage(props()));
    expect(screen.getByText(en.error.title)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.error.retry }));
    expect(router.refresh).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('shows the empty state when the workspace sees no forums', async () => {
    page.index = { cities: [], disabled: [] };
    withIntl(await CourtsPage(props()));
    const empty = document.querySelector('[data-pattern-state="empty"]');
    expect(empty?.textContent).toContain(en.empty.title);
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('says it is showing saved court information while offline', async () => {
    setOnline(false);
    withIntl(await CourtsPage(props()));
    expect(document.querySelector('[data-courts-offline]')?.textContent).toMatch(
      /^Showing saved court information from .+\.$/,
    );
  });

  it('previews the skeleton and the error boundary in development only', async () => {
    withIntl(await CourtsPage(props({ __state: 'loading' })));
    expect(document.querySelector('[data-slot="courts-skeleton"]')).not.toBeNull();
    expect(court.getCourtsIndex).not.toHaveBeenCalled();
    cleanup();
    await expect(CourtsPage(props({ __state: 'error' }))).rejects.toThrow();
    page.dev = false;
    withIntl(await CourtsPage(props({ __state: 'loading' })));
    expect(document.querySelector('[data-slot="courts-skeleton"]')).toBeNull();
    expect(screen.getByRole('grid')).toBeTruthy();
  });

  it('is not found without a workspace context', async () => {
    page.context = null;
    await expect(CourtsPage(props())).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('courts route boundaries (#399)', () => {
  it('loading.tsx is a labelled skeleton of forum cards', () => {
    withIntl(<CourtsLoading />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(en.loading);
    expect(status.getAttribute('aria-busy')).toBe('true');
  });

  it('error.tsx reports the error and retries with reset', () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('boom'), { digest: 'd1' });
    withIntl(<CourtsError error={error} reset={reset} />);
    expect(screen.getByText(en.error.title)).toBeTruthy();
    expect(screen.queryByText('boom')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.error.retry }));
    expect(reset).toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(error, { boundary: 'route', digest: 'd1' });
  });
});
