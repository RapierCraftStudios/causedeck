// @vitest-environment jsdom
// The matter's Proceedings tab (#392, #40 part 4) inside the matter layout: the tab is in the
// registry's tab bar and selected, the tree (`role="tree"`) shows each proceeding with its formatted
// case number, forum, state word, chips and next date, SR/FR-stage rows are marked unnumbered and
// children are nested in a `role="group"`. Writers get the toolbar, Edit and the state menus;
// viewers and clerks get none of them in the DOM (absent, not disabled). Another workspace or an
// unknown matter is a not-found, FORBIDDEN is the permission-denied screen, a failed load throws to
// the matter's error boundary, and the dev `__state` previews and the loading skeleton exist.
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MatterOverview, ProceedingNode } from '@causedeck/core/matter-graph';

import { resetMatterTabs } from '../lib/matters/tab-registry.ts';
import type { Role, WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const MATTER_ID = '00000000-0000-4000-8000-000000000001';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const nav = vi.hoisted(() => ({
  pathname: '/w/demo/matters/00000000-0000-4000-8000-000000000001/proceedings',
}));
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  dev: true,
  nodes: [] as ProceedingNode[],
  error: null as Error | null,
}));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const graph = vi.hoisted(() => ({
  PROCEEDING_TRANSITIONS: {
    filed: ['sr_fr'],
    sr_fr: ['defects', 'numbered'],
    defects: ['re_presented'],
    re_presented: ['defects', 'numbered'],
    numbered: ['disposed'],
    disposed: ['numbered'],
  },
  listMatterProceedingsTree: vi.fn(() =>
    page.error === null ? Promise.resolve(page.nodes) : Promise.reject(page.error),
  ),
  getMatterOverview: vi.fn(),
}));
const court = vi.hoisted(() => ({
  getCourtsIndex: vi.fn(() =>
    Promise.resolve({
      cities: [
        {
          city: 'Chennai',
          courts: [
            {
              court: 'High Court of Madras',
              forums: [
                {
                  id: 'f1',
                  code: 'in.tn.madras-hc.principal.appellate',
                  court: 'High Court of Madras',
                  seat: 'Chennai',
                },
              ],
            },
          ],
        },
      ],
      disabled: [],
    }),
  ),
}));
const logger = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => nav.pathname,
  useParams: () => ({ slug: 'demo', id: MATTER_ID }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
  getLocale: () => Promise.resolve('en'),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => page.dev }));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/matter-graph', () => graph);
vi.mock('@causedeck/core/court', () => court);
vi.mock('../app/(app)/w/[slug]/matters/[id]/actions.ts', () => ({
  updateMatterAction: vi.fn(),
  setSensitiveAction: vi.fn(),
  confirmNextDateAction: vi.fn(),
  chooseNextDateSourceAction: vi.fn(),
}));
vi.mock('../app/(app)/w/[slug]/matters/actions.ts', () => ({
  searchMattersAction: vi.fn(),
  createMatterAction: vi.fn(),
}));
vi.mock('../app/(app)/w/[slug]/matters/[id]/proceedings/actions.ts', () => ({
  createProceedingAction: vi.fn(),
  updateProceedingAction: vi.fn(),
  transitionProceedingAction: vi.fn(),
  linkProceedingsAction: vi.fn(),
  findDuplicateProceedingsAction: vi.fn(),
  previewMergeAction: vi.fn(),
  previewSplitAction: vi.fn(),
  mergeMattersAction: vi.fn(),
  undoMergeAction: vi.fn(),
  splitMatterAction: vi.fn(),
  undoSplitAction: vi.fn(),
}));

const { default: MatterLayout } = await import('../app/(app)/w/[slug]/matters/[id]/layout.tsx');
const { default: ProceedingsPage, generateMetadata } =
  await import('../app/(app)/w/[slug]/matters/[id]/proceedings/page.tsx');
const { default: ProceedingsLoading } =
  await import('../app/(app)/w/[slug]/matters/[id]/proceedings/loading.tsx');

const ws = catalogs.en.matters.workspace;
const tab = ws.proceedingsTab;
const FORUM = { id: 'f1', court: 'High Court of Madras', establishment: null, seat: 'Chennai' };

function node(id: string, overrides: Partial<ProceedingNode> = {}): ProceedingNode {
  return {
    id,
    kind: 'main',
    state: 'numbered',
    caseType: 'W.P.',
    caseTypeCode: 'WP',
    number: '12345',
    year: 2026,
    srNo: null,
    frNo: null,
    diaryNo: null,
    filingNo: null,
    cnr: 'TNMD010012342026',
    unnumbered: false,
    petitioner: null,
    respondent: null,
    forum: FORUM,
    nextDate: null,
    links: [],
    children: [],
    ...overrides,
  };
}

function tree(): ProceedingNode[] {
  return [
    node('wp', {
      children: [
        node('wmp', {
          kind: 'misc',
          caseType: 'W.M.P.',
          number: null,
          year: null,
          state: 'sr_fr',
          unnumbered: true,
          srNo: '4521',
          cnr: null,
        }),
      ],
    }),
  ];
}

function overview(): MatterOverview {
  return {
    header: {
      id: MATTER_ID,
      title: 'Rao v. State of Tamil Nadu',
      status: 'active',
      sensitive: false,
      practiceArea: null,
      openedAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-10-20T06:30:00Z'),
      owner: null,
      clients: [],
    },
    nextDate: null,
    conflicts: [],
    proceedings: { count: 2, byState: {}, lead: null },
    openObligations: 0,
    recentDocuments: [],
    people: [],
    synopsis: null,
    synopsisDenied: false,
  };
}

const params = Promise.resolve({ slug: 'demo', id: MATTER_ID });

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

async function renderRoute(query: Record<string, string> = {}) {
  const content = await ProceedingsPage({ params, searchParams: Promise.resolve(query) });
  const shell = await MatterLayout({ params, children: content });
  return withIntl(shell);
}

class WorkspaceError extends Error {
  override name = 'WorkspaceError';
  constructor(readonly code: string) {
    super(code);
  }
}

function as(role: Role) {
  page.context = testWorkspaceContext('demo', role);
}

beforeEach(() => {
  resetMatterTabs();
  as('owner');
  page.dev = true;
  page.nodes = tree();
  page.error = null;
  graph.getMatterOverview.mockResolvedValue(overview());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('matter Proceedings tab (#392)', () => {
  it('is a registered tab, selected on its route', async () => {
    await renderRoute();
    const tablist = screen.getByRole('tablist', { name: ws.tabListLabel });
    const proceedings = within(tablist).getByRole('tab', { name: ws.tabs.proceedings });
    expect(proceedings.getAttribute('href')).toBe(`/w/demo/matters/${MATTER_ID}/proceedings`);
    expect(proceedings.getAttribute('aria-selected')).toBe('true');
    expect(within(tablist).getByRole('tab', { name: ws.tabs.overview })).toBeTruthy();
  });

  it('renders the tree: case numbers, forum, state, chips, unnumbered children', async () => {
    await renderRoute();
    const treeEl = screen.getByRole('tree', { name: tab.treeLabel });
    const items = within(treeEl).getAllByRole('treeitem');
    expect(items.map((item) => item.getAttribute('aria-level'))).toEqual(['1', '2']);
    const [main, child] = items as [HTMLElement, HTMLElement];
    expect(main.getAttribute('aria-expanded')).toBe('true');
    expect(main.getAttribute('tabindex')).toBe('0');
    expect(child.getAttribute('tabindex')).toBe('-1');
    expect(within(main).getAllByText('W.P. No. 12345 of 2026').length).toBeGreaterThan(0);
    expect(main.textContent).toContain('High Court of Madras, Chennai');
    expect(main.textContent).toContain(ws.proceedings.states.numbered);
    expect(main.textContent).toContain('CNR TNMD010012342026');
    expect(main.querySelector('[data-copy-cnr="TNMD010012342026"]')).not.toBeNull();
    expect(main.textContent).toContain(tab.noNextDate);
    expect(child.closest('[role="group"]')).not.toBeNull();
    expect(child.querySelector('[data-unnumbered]')?.textContent).toBe(tab.unnumbered);
    expect(child.textContent).toContain('W.M.P. (unnumbered)');
    expect(child.textContent).toContain('SR 4521');
    expect(child.textContent).toContain(ws.proceedings.states.sr_fr);
    expect(document.body.textContent).not.toContain('₹');
  });

  it('gives a writer the toolbar, Edit and the state menus', async () => {
    await renderRoute();
    expect(screen.getByRole('toolbar', { name: tab.toolbarLabel })).toBeTruthy();
    expect(screen.getByRole('button', { name: tab.add })).toBeTruthy();
    expect(screen.getByRole('button', { name: tab.mergeIn })).toBeTruthy();
    expect(screen.getByRole('button', { name: tab.splitStart })).toBeTruthy();
    expect(document.querySelectorAll('[data-transition-menu]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-edit-proceeding]')).toHaveLength(2);
  });

  it.each(['viewer', 'clerk'] as const)(
    'gives a %s the tree without any mutation control',
    async (role) => {
      as(role);
      await renderRoute();
      expect(screen.getByRole('tree')).toBeTruthy();
      expect(screen.queryByRole('toolbar')).toBeNull();
      expect(document.querySelector('[data-transition-menu]')).toBeNull();
      expect(document.querySelector('[data-edit-proceeding]')).toBeNull();
      expect(document.querySelector('[data-add-proceeding]')).toBeNull();
    },
  );

  it('shows the empty state with one primary action for a writer, none for a viewer', async () => {
    page.nodes = [];
    await renderRoute();
    const empty = document.querySelector('[data-proceedings="empty"]') as HTMLElement;
    expect(empty.textContent).toContain(tab.empty.title);
    expect(empty.querySelectorAll('button')).toHaveLength(1);
    cleanup();
    as('viewer');
    await renderRoute({ __state: 'empty' });
    expect(
      (document.querySelector('[data-proceedings="empty"]') as HTMLElement).querySelector('button'),
    ).toBeNull();
  });

  it('is a not-found for another workspace, an unknown matter or no context', async () => {
    page.error = new WorkspaceError('NOT_FOUND');
    await expect(ProceedingsPage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    page.error = null;
    page.context = null;
    await expect(ProceedingsPage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('shows the permission-denied screen on FORBIDDEN and throws on a failed load', async () => {
    page.error = new WorkspaceError('FORBIDDEN');
    withIntl(await ProceedingsPage({ params, searchParams: Promise.resolve({}) }));
    expect(screen.getByText(catalogs.en.matters.denied)).toBeTruthy();
    cleanup();
    page.error = new Error('db down');
    await expect(ProceedingsPage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow();
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('Rao');
  });

  it('previews loading, error, denied and offline in development only', async () => {
    withIntl(
      await ProceedingsPage({ params, searchParams: Promise.resolve({ __state: 'loading' }) }),
    );
    expect(document.querySelector('[data-slot="proceedings-skeleton"]')).not.toBeNull();
    cleanup();
    await expect(
      ProceedingsPage({ params, searchParams: Promise.resolve({ __state: 'error' }) }),
    ).rejects.toThrow();
    withIntl(
      await ProceedingsPage({ params, searchParams: Promise.resolve({ __state: 'denied' }) }),
    );
    expect(screen.getByText(catalogs.en.matters.denied)).toBeTruthy();
    cleanup();
    await renderRoute({ __state: 'offline' });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: tab.add }).disabled).toBe(true);
    cleanup();
    page.dev = false;
    withIntl(
      await ProceedingsPage({ params, searchParams: Promise.resolve({ __state: 'loading' }) }),
    );
    expect(screen.getByRole('tree')).toBeTruthy();
  });

  it('has a loading skeleton in the tree layout, and a title with the matter', async () => {
    withIntl(<ProceedingsLoading />);
    const skeleton = document.querySelector('[data-slot="proceedings-skeleton"]') as HTMLElement;
    expect(skeleton.querySelectorAll('[data-proceedings-skeleton="row"]')).toHaveLength(4);
    graph.getMatterOverview.mockResolvedValue(overview());
    expect(await generateMetadata({ params })).toEqual({
      title: `${ws.tabs.proceedings} · Rao v. State of Tamil Nadu`,
    });
  });
});
