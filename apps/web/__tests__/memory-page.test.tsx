// @vitest-environment jsdom
// Memory page (#73): a member who may read memory gets the screen, read through
// `@causedeck/core/memory` in their own workspace scope; a clerk gets the permission-denied
// explanation, never an empty list; `?__state=denied` previews it in development.
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const page = vi.hoisted(() => ({ context: null as WorkspaceContext | null, dev: true }));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const core = vi.hoisted(() => ({
  listMemoryWithUsage: vi.fn(() => Promise.resolve([])),
  listMemoryProposals: vi.fn(() => Promise.resolve([])),
  getLastMemoryReview: vi.fn(() => Promise.resolve(null)),
  isMemoryPaused: vi.fn(() => Promise.resolve(false)),
  tenureMetrics: vi.fn(() => Promise.reject(new Error('not shown'))),
}));
const view = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
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
vi.mock('../lib/memory/deps.ts', () => ({ memoryDeps: (db: unknown) => ({ db }) }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/memory', () => core);
vi.mock('../app/(app)/w/[slug]/memory/_components/memory-list.tsx', () => ({
  MemoryScreen: (props: { canWrite: boolean; cards: unknown[] }) => {
    view(props);
    return <div data-testid="memory-screen" />;
  },
}));

const { default: MemoryPage } = await import('../app/(app)/w/[slug]/memory/page.tsx');

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

beforeEach(() => {
  page.context = testWorkspaceContext('demo', 'owner');
  page.dev = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('memory page (#73)', () => {
  it('reads memory in the member workspace scope and renders the screen', async () => {
    withIntl(await MemoryPage(props()));
    expect(screen.getByTestId('memory-screen')).toBeTruthy();
    expect(runtime.inWorkspace).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', userId: 'user-1' },
      expect.any(Function),
    );
    expect(core.listMemoryWithUsage).toHaveBeenCalledOnce();
    expect(view.mock.calls[0]?.[0]).toMatchObject({ canWrite: true, cards: [] });
  });

  it('shows a clerk the permission-denied explanation, reading nothing', async () => {
    page.context = testWorkspaceContext('demo', 'clerk');
    withIntl(await MemoryPage(props()));
    expect(screen.queryByTestId('memory-screen')).toBeNull();
    expect(screen.getByText(catalogs.en.memory.denied)).toBeTruthy();
    expect(core.listMemoryWithUsage).not.toHaveBeenCalled();
  });

  it('previews permission-denied in development', async () => {
    withIntl(await MemoryPage(props({ __state: 'denied' })));
    expect(screen.getByText(catalogs.en.memory.denied)).toBeTruthy();
  });

  it('answers not found for a workspace the user is not in', async () => {
    page.context = null;
    await expect(MemoryPage(props())).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
