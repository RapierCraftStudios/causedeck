// @vitest-environment jsdom
// Matter workspace layout and Overview page (#390, #40 part 3): the header (title, client chips,
// status, owner, the `Sensitive` lock badge), the tab bar from the registry (`role="tablist"`), the
// Next-date card with its provenance chip and `Confirm` only for a proposed date and a writer, the
// Conflict card with both sides and Choose A / Choose B / Enter manually only for writers, the
// proceedings summary, open obligations, recent documents, people and the synopsis, which a clerk
// sees as a permission-denied state. Viewers get no mutation controls at all, the sensitive menu
// exists for owners and advocates only, another workspace or an unknown matter is a not-found,
// and the dev `__state` previews and the loading, error and not-found screens exist.
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListingDetail, MatterOverview } from '@causedeck/core/matter-graph';

import { resetMatterTabs } from '../lib/matters/tab-registry.ts';
import type { Role, WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const MATTER_ID = '00000000-0000-4000-8000-000000000001';
const PROCEEDING_ID = '00000000-0000-4000-8000-0000000000b1';
const CURRENT_ID = '00000000-0000-4000-8000-0000000000c1';
const PROPOSED_ID = '00000000-0000-4000-8000-0000000000c2';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const nav = vi.hoisted(() => ({
  pathname: '/w/demo/matters/00000000-0000-4000-8000-000000000001',
}));
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  dev: true,
  overview: null as MatterOverview | null,
  error: null as Error | null,
  notices: [] as unknown[],
  noticesError: null as Error | null,
}));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const graph = vi.hoisted(() => ({
  getMatterOverview: vi.fn(() =>
    page.error === null ? Promise.resolve(page.overview) : Promise.reject(page.error),
  ),
}));
const notices = vi.hoisted(() => ({
  listMatterNotices: vi.fn(() =>
    page.noticesError === null ? Promise.resolve(page.notices) : Promise.reject(page.noticesError),
  ),
}));
const facts = vi.hoisted(() => {
  const agree = {
    status: 'agree',
    sources: [{ sourceType: 'adapter', sourceRef: null, value: '2026-05-14', confidence: 0.9 }],
    value: '2026-05-14',
    confidence: 0.9,
    groups: [],
  };
  return {
    error: null as Error | null,
    getNextDateAgreement: vi.fn(() =>
      facts.error === null ? Promise.resolve(agree) : Promise.reject(facts.error),
    ),
    getStageAgreement: vi.fn(() =>
      facts.error === null ? Promise.resolve(agree) : Promise.reject(facts.error),
    ),
  };
});
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
const reportError = vi.hoisted(() => vi.fn());

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
vi.mock('../lib/report-error.ts', () => ({ reportError }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/matter-graph', () => graph);
vi.mock('@causedeck/core/notices', () => notices);
vi.mock('@causedeck/core/facts', () => facts);
vi.mock('../app/(app)/w/[slug]/matters/[id]/actions.ts', () => ({
  updateMatterAction: vi.fn(),
  setSensitiveAction: vi.fn(),
  confirmNextDateAction: vi.fn(),
  chooseNextDateSourceAction: vi.fn(),
  reportRecordErrorAction: vi.fn(),
}));

const { default: MatterLayout } = await import('../app/(app)/w/[slug]/matters/[id]/layout.tsx');
const { default: MatterPage, generateMetadata } =
  await import('../app/(app)/w/[slug]/matters/[id]/page.tsx');
const { default: MatterLoading } = await import('../app/(app)/w/[slug]/matters/[id]/loading.tsx');
const { default: MatterError } = await import('../app/(app)/w/[slug]/matters/[id]/error.tsx');
const { default: MatterNotFound } =
  await import('../app/(app)/w/[slug]/matters/[id]/not-found.tsx');

const ws = catalogs.en.matters.workspace;

function listing(overrides: Partial<ListingDetail> = {}): ListingDetail {
  return {
    date: '2026-11-14',
    proceedingId: PROCEEDING_ID,
    listingId: CURRENT_ID,
    sourceType: 'adapter',
    confirmationState: 'confirmed',
    stage: 'listed',
    canonical: true,
    provenance: {
      sourceType: 'adapter',
      sourceRef: 'cause-list:2026-11-13',
      anchorId: null,
      confidence: null,
      confirmationState: 'confirmed',
      capturedAt: new Date('2026-11-13T10:00:00Z'),
    },
    ...overrides,
  };
}

function overview(overrides: Partial<MatterOverview> = {}): MatterOverview {
  const forum = { id: 'f1', court: 'Madras High Court', establishment: null, seat: 'Chennai' };
  return {
    header: {
      id: MATTER_ID,
      title: 'Rao v. State of Tamil Nadu',
      status: 'active',
      sensitive: true,
      practiceArea: null,
      openedAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-10-20T06:30:00Z'),
      owner: { memberId: 'm1', userId: 'user-1', name: 'Asha Rao' },
      clients: [{ id: 'p1', name: 'K. Rao', aliases: [], kind: 'client', contact: null }],
    },
    nextDate: listing(),
    conflicts: [],
    proceedings: {
      count: 3,
      byState: { numbered: 2, sr_fr: 1 },
      lead: { id: PROCEEDING_ID, caseType: 'W.P.', number: '12345', year: 2026, forum },
    },
    openObligations: 2,
    recentDocuments: [
      {
        id: 'd1',
        kind: 'order',
        language: 'ta',
        textStatus: 'layer',
        source: { type: 'manual' },
        supersedesDocumentId: null,
        supersededByDocumentId: null,
        createdAt: new Date('2026-10-01T06:00:00Z'),
      },
    ],
    people: [
      {
        kind: 'represents',
        edges: [
          {
            edgeId: 'e1',
            proceedingId: null,
            person: { id: 'p1', name: 'K. Rao', aliases: [], kind: 'client', contact: null },
            provenance: { sourceType: 'manual', confirmationState: 'confirmed' },
          },
        ],
      },
      {
        kind: 'opposes',
        edges: [
          {
            edgeId: 'e2',
            proceedingId: null,
            person: { id: 'p2', name: 'S. Iyer', aliases: [], kind: 'advocate', contact: null },
            provenance: { sourceType: 'manual', confirmationState: 'confirmed' },
          },
        ],
      },
      { kind: 'assigned_to', edges: [] },
    ],
    synopsis: {
      text: 'Challenge to the land acquisition notice.',
      provenance: { sourceType: 'manual' },
    },
    synopsisDenied: false,
    ...overrides,
  };
}

const conflict = {
  proceedingId: PROCEEDING_ID,
  current: listing(),
  proposed: listing({
    listingId: PROPOSED_ID,
    date: '2026-11-21',
    canonical: false,
    confirmationState: 'proposed',
    provenance: {
      sourceType: 'ai',
      sourceRef: 'order:1',
      anchorId: null,
      confidence: '0.800',
      confirmationState: 'proposed',
      capturedAt: new Date('2026-11-13T10:00:00Z'),
    },
  }),
};

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

const params = Promise.resolve({ slug: 'demo', id: MATTER_ID });

/** The layout around the Overview page, as Next renders it. */
async function renderRoute(query: Record<string, string> = {}) {
  const content = await MatterPage({ params, searchParams: Promise.resolve(query) });
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

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

beforeEach(() => {
  resetMatterTabs();
  as('owner');
  page.dev = true;
  page.overview = overview();
  page.error = null;
  page.notices = [];
  page.noticesError = null;
  facts.error = null;
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('matter workspace Overview (#390)', () => {
  it('shows the header, the tab bar and every Overview card', async () => {
    await renderRoute();
    const header = document.querySelector('[data-slot="matter-header"]') as HTMLElement;
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe(
      'Rao v. State of Tamil Nadu',
    );
    expect(within(header).getByText('K. Rao')).toBeTruthy();
    expect(within(header).getByText(ws.status.active)).toBeTruthy();
    expect(within(header).getByText('Owner: Asha Rao')).toBeTruthy();
    expect(header.querySelector('[data-matter-sensitive]')).not.toBeNull();

    const tablist = screen.getByRole('tablist', { name: ws.tabListLabel });
    const tab = within(tablist).getByRole('tab', { name: ws.tabs.overview });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.getAttribute('href')).toBe(`/w/demo/matters/${MATTER_ID}`);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab.id);

    const nextDate = document.querySelector('[data-slot="next-date-card"]') as HTMLElement;
    expect(nextDate.textContent).toContain('14');
    expect(nextDate.querySelector('[data-confirmation="confirmed"]')).not.toBeNull();
    expect(within(nextDate).getByText(ws.source.adapter)).toBeTruthy();
    expect(nextDate.querySelector('[data-next-date-confirm]')).toBeNull();

    const proceedings = document.querySelector('[data-slot="matter-proceedings"]') as HTMLElement;
    expect(proceedings.textContent).toContain('3 proceedings');
    expect(proceedings.textContent).toContain('W.P. No. 12345 of 2026');
    expect(proceedings.querySelector('[data-proceedings-state="sr_fr"]')).not.toBeNull();
    expect(screen.getByText('2 open obligations')).toBeTruthy();
    const docs = document.querySelector('[data-slot="matter-documents"]') as HTMLElement;
    expect(within(docs).getByText(ws.documents.kinds.order)).toBeTruthy();
    expect(within(docs).getByText('TA').getAttribute('lang')).toBe('ta');
    const people = document.querySelector('[data-slot="matter-people"]') as HTMLElement;
    expect(people.querySelector('[data-people-group="represents"]')?.textContent).toContain(
      'K. Rao',
    );
    expect(people.querySelector('[data-people-group="opposes"]')?.textContent).toContain('S. Iyer');
    expect(people.querySelector('[data-people-group="assigned_to"]')).toBeNull();
    expect(screen.getByText('Challenge to the land acquisition notice.')).toBeTruthy();
    expect(screen.getByText(ws.synopsis.manual)).toBeTruthy();
    expect(document.querySelector('[data-synopsis-edit]')).not.toBeNull();
    // The polite live region exists.
    expect(document.querySelector('[data-matter-announcer]')?.getAttribute('aria-live')).toBe(
      'polite',
    );
    expect(document.body.textContent).not.toContain('₹');
  });

  it('offers Confirm only for a proposed next date and a member who may write', async () => {
    page.overview = overview({
      nextDate: listing({
        confirmationState: 'proposed',
        provenance: { ...listing().provenance, confirmationState: 'proposed' },
      }),
    });
    await renderRoute();
    expect(document.querySelector('[data-confirmation="proposed"]')?.textContent).toBe(
      catalogs.en.matters.nextDate.toConfirm,
    );
    expect(screen.getByRole('button', { name: ws.nextDate.confirm })).toBeTruthy();
    cleanup();
    as('viewer');
    await renderRoute();
    expect(screen.queryByRole('button', { name: ws.nextDate.confirm })).toBeNull();
  });

  it('shows both sides of a conflict; only writers get Choose A, Choose B and Enter manually', async () => {
    page.overview = overview({ conflicts: [conflict] });
    await renderRoute();
    const card = screen.getByRole('region', { name: ws.conflict.title });
    expect(card.querySelector('[data-conflict-side="A"]')?.textContent).toContain('14');
    expect(card.querySelector('[data-conflict-side="B"]')?.textContent).toContain('21');
    expect(within(card).getByText(ws.source.ai)).toBeTruthy();
    expect(within(card).getByRole('button', { name: ws.conflict.chooseA })).toBeTruthy();
    expect(within(card).getByRole('button', { name: ws.conflict.chooseB })).toBeTruthy();
    expect(within(card).getByRole('button', { name: ws.conflict.manual })).toBeTruthy();
    cleanup();
    as('viewer');
    await renderRoute();
    const read = screen.getByRole('region', { name: ws.conflict.title });
    expect(read.querySelector('[data-conflict-side="B"]')).not.toBeNull();
    expect(read.querySelector('[data-conflict-choose]')).toBeNull();
    expect(read.querySelector('[data-conflict-manual]')).toBeNull();
  });

  it('replaces the synopsis with a permission-denied state for a clerk', async () => {
    as('clerk');
    page.overview = overview({ synopsis: null, synopsisDenied: true });
    await renderRoute();
    const synopsis = document.querySelector('[data-slot="synopsis"]') as HTMLElement;
    expect(synopsis.dataset.synopsis).toBe('denied');
    expect(synopsis.querySelector('[data-pattern-state="permission-denied"]')).not.toBeNull();
    expect(synopsis.textContent).toContain(ws.synopsis.denied);
    expect(document.body.textContent).not.toContain('Challenge to the land acquisition notice.');
  });

  it('gives a viewer no mutation controls at all and no matter menu', async () => {
    as('viewer');
    page.overview = overview({
      conflicts: [conflict],
      nextDate: listing({ confirmationState: 'proposed' }),
    });
    await renderRoute();
    for (const selector of [
      '[data-next-date-confirm]',
      '[data-conflict-choose]',
      '[data-conflict-manual]',
      '[data-synopsis-edit]',
      '[data-matter-menu]',
    ]) {
      expect(document.querySelector(selector), selector).toBeNull();
    }
    // A viewer reads the synopsis but cannot write it.
    expect(screen.getByText('Challenge to the land acquisition notice.')).toBeTruthy();
  });

  it('puts the sensitive toggle on the matter menu for owners and advocates only', async () => {
    for (const role of ['owner', 'advocate'] as const) {
      as(role);
      await renderRoute();
      expect(screen.getByRole('button', { name: ws.menu.label })).toBeTruthy();
      cleanup();
    }
    for (const role of ['junior', 'clerk', 'viewer'] as const) {
      as(role);
      await renderRoute();
      expect(screen.queryByRole('button', { name: ws.menu.label }), role).toBeNull();
      cleanup();
    }
  });

  it('shows no lock badge for a matter that is not sensitive', async () => {
    page.overview = overview({ header: { ...overview().header, sensitive: false } });
    await renderRoute();
    expect(document.querySelector('[data-matter-sensitive]')).toBeNull();
  });

  it('is a not-found for another workspace, an unknown or restricted matter', async () => {
    page.context = null;
    await expect(MatterPage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    await expect(MatterLayout({ params, children: null })).rejects.toThrow('NEXT_NOT_FOUND');
    as('owner');
    page.error = new WorkspaceError('NOT_FOUND');
    await expect(MatterPage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    // The layout renders only the page, so this segment's not-found screen shows.
    const shell = await MatterLayout({ params, children: <p>page</p> });
    withIntl(shell);
    expect(document.querySelector('[data-slot="matter-header"]')).toBeNull();
    expect(screen.getByText('page')).toBeTruthy();
    // The id is passed through to the read model, never trusted.
    expect(graph.getMatterOverview).toHaveBeenCalledWith(
      expect.anything(),
      { workspaceId: 'ws-1', userId: 'user-1' },
      { matterId: MATTER_ID },
    );
  });

  it('shows the permission-denied screen on FORBIDDEN and throws to the boundary on errors', async () => {
    page.error = new WorkspaceError('FORBIDDEN');
    withIntl(await MatterPage({ params, searchParams: Promise.resolve({}) }));
    expect(screen.getByText(catalogs.en.matters.denied)).toBeTruthy();
    cleanup();
    page.error = new Error('db down');
    await expect(MatterPage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow(
      'Matter could not be loaded',
    );
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('Rao');
  });

  it('lists the notices affecting the matter, with provenance and the official link (#588)', async () => {
    page.notices = [
      {
        id: 'n-1',
        title: 'Holiday list for 2027',
        kind: 'holiday',
        issuedOn: '2026-11-05',
        effectiveOn: null,
        url: 'https://mhc.example.test/notices/holiday-2027.pdf',
        forumCodes: ['in.tn.madras-hc.madurai'],
        sourceId: 'in.tn.madras-hc.notices',
        sourceName: 'Madras High Court',
        recordedAt: new Date('2026-11-06T04:00:00Z'),
        matterCount: 1,
      },
    ];
    withIntl(await MatterPage({ params, searchParams: Promise.resolve({}) }));
    const card = document.querySelector('[data-slot="matter-notices"]');
    expect(card?.textContent).toContain('Holiday list for 2027');
    expect(card?.textContent).toContain('Madras High Court');
    const link = card?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://mhc.example.test/notices/holiday-2027.pdf');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(notices.listMatterNotices).toHaveBeenCalledWith(
      expect.anything(),
      { workspaceId: 'ws-1', userId: 'user-1' },
      MATTER_ID,
    );
  });

  it('shows an empty notices card, and still renders the matter when notices fail to load (#588)', async () => {
    withIntl(await MatterPage({ params, searchParams: Promise.resolve({}) }));
    expect(
      document.querySelector('[data-slot="matter-notices"] [data-notices="empty"]'),
    ).not.toBeNull();
    cleanup();
    page.noticesError = new Error('db down');
    withIntl(await MatterPage({ params, searchParams: Promise.resolve({}) }));
    expect(
      document.querySelector('[data-slot="matter-notices"] [data-notices="empty"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-slot="matter-overview"]')).not.toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('shows the confidence chip, and still loads the Overview without it when the agreement read fails (#499)', async () => {
    await renderRoute();
    expect(document.querySelector('[data-confidence-chip="date"]')).not.toBeNull();
    cleanup();
    facts.error = new Error('db down');
    await renderRoute();
    expect(document.querySelector('[data-slot="matter-overview"]')).not.toBeNull();
    expect(document.querySelector('[data-confidence-chip]')).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('previews the states in development only', async () => {
    withIntl(await MatterPage({ params, searchParams: Promise.resolve({ __state: 'loading' }) }));
    expect(document.querySelector('[data-pattern-state="loading"]')).not.toBeNull();
    cleanup();
    await expect(
      MatterPage({ params, searchParams: Promise.resolve({ __state: 'error' }) }),
    ).rejects.toThrow('dev toggle');
    withIntl(await MatterPage({ params, searchParams: Promise.resolve({ __state: 'denied' }) }));
    expect(screen.getByText(catalogs.en.matters.denied)).toBeTruthy();
    cleanup();
    await renderRoute({ __state: 'empty' });
    expect(screen.getByText(ws.nextDate.none)).toBeTruthy();
    expect(screen.getByText(ws.proceedings.empty)).toBeTruthy();
    expect(screen.getByText(ws.people.empty)).toBeTruthy();
    expect(screen.getByText(ws.documents.empty)).toBeTruthy();
    expect(screen.getByRole('link', { name: ws.documents.openInbox }).getAttribute('href')).toBe(
      '/w/demo/inbox',
    );
    expect(screen.getByText(ws.synopsis.empty)).toBeTruthy();
    expect(screen.getByText('No open obligations')).toBeTruthy();
    cleanup();
    page.overview = overview({ conflicts: [conflict] });
    await renderRoute({ __state: 'offline' });
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-conflict-choose]')) {
      expect(button.disabled).toBe(true);
    }
    cleanup();
    page.dev = false;
    await renderRoute({ __state: 'loading' });
    expect(document.querySelector('[data-slot="matter-overview"]')).not.toBeNull();
  });

  it('names the page after the matter', async () => {
    expect(await generateMetadata({ params })).toEqual({ title: 'Rao v. State of Tamil Nadu' });
    page.error = new WorkspaceError('NOT_FOUND');
    expect(await generateMetadata({ params })).toEqual({ title: ws.metaTitle });
  });
});

describe('matter workspace boundaries (#390)', () => {
  it('has a loading skeleton shaped like the Overview', () => {
    withIntl(<MatterLoading />);
    expect(screen.getByRole('status').textContent).toContain(ws.loading);
    expect(document.querySelector('[data-matter-skeleton="next-date"]')).not.toBeNull();
  });

  it('has an error boundary with Retry and the reference, never the message', () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('secret party data'), { digest: 'abc123' });
    withIntl(<MatterError error={error} reset={reset} />);
    expect(screen.getByText(ws.error.title)).toBeTruthy();
    expect(screen.getByText('Reference: abc123')).toBeTruthy();
    expect(document.body.textContent).not.toContain('secret party data');
    screen.getByRole('button', { name: ws.error.retry }).click();
    expect(reset).toHaveBeenCalled();
  });

  it('has a not-found screen with one way back to the list', () => {
    withIntl(<MatterNotFound />);
    expect(screen.getByText(ws.notFound.title)).toBeTruthy();
    expect(screen.getByRole('link', { name: ws.notFound.back }).getAttribute('href')).toBe(
      '/w/demo/matters',
    );
  });
});
