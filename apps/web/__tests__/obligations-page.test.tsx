// @vitest-environment jsdom
// Obligations page (#68): a member who may read obligations gets the queue, read through
// `@causedeck/core/obligations` in their own workspace scope; a role that may not read gets
// permission-denied; `?__state=denied|empty` previews a state in development.
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
  queryQueueView: vi.fn(() =>
    Promise.resolve({ overdue: [], today: [], this_week: [], later: [], undated: [] }),
  ),
  listDefects: vi.fn(() => Promise.resolve([])),
  listCertifiedCopies: vi.fn(() => Promise.resolve([])),
  obligationOptions: vi.fn(() => Promise.resolve({ matters: [], members: [] })),
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
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/obligations', () => core);
vi.mock('../app/(app)/w/[slug]/obligations/_components/queue-view.tsx', () => ({
  QueueView: (props: { canWrite: boolean; items: unknown[] }) => {
    view(props);
    return <div data-testid="queue-view" />;
  },
}));

const { default: ObligationsPage } = await import('../app/(app)/w/[slug]/obligations/page.tsx');

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

describe('obligations page (#68)', () => {
  it('reads the queue in the member workspace scope and renders it', async () => {
    withIntl(await ObligationsPage(props()));
    expect(screen.getByTestId('queue-view')).toBeTruthy();
    expect(runtime.inWorkspace).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', userId: 'user-1' },
      expect.any(Function),
    );
    expect(core.queryQueueView).toHaveBeenCalledOnce();
    expect(view.mock.calls[0]?.[0]).toMatchObject({ canWrite: true, items: [] });
  });

  it('previews permission-denied without reading anything', async () => {
    withIntl(await ObligationsPage(props({ __state: 'denied' })));
    expect(screen.queryByTestId('queue-view')).toBeNull();
    expect(screen.getByText(catalogs.en.obligations.denied)).toBeTruthy();
    expect(core.queryQueueView).not.toHaveBeenCalled();
  });

  it('answers not found for a workspace the user is not in', async () => {
    page.context = null;
    await expect(ObligationsPage(props())).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
