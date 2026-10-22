// @vitest-environment jsdom
// The matter Timeline tab (#41, PRD PR-2, MG-1): the graph beside the cross-proceeding timeline.
// Events sort under month headings with a Today marker, future ones muted; every event has its
// Provenance Chip, proposed ones a `To confirm` pill, and an `Open source` link into the Documents
// tab at the source page; the filters, the proceedings selection and the layout mode are URL (and
// storage) state; the five states exist; each role sees only the kinds of event it may read; and
// nothing counts, ranks or summarises judges. The loader runs against a mocked core. Every text is
// fictional.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MatterGraph, TimelineAnchor, TimelineEvent } from '@causedeck/core/matter-graph';

import { mockMatchMedia, stubResizeObserver } from '../components/shell/__tests__/helpers.tsx';
import { buildRows, monthTarget, todayIndex } from '../components/matters/timeline/timeline.tsx';
import {
  EMPTY_QUERY,
  MODE_STORAGE_KEY,
  filterEvents,
  isFiltered,
  parseTimelineQuery,
  selectedProceedings,
  serializeTimelineQuery,
} from '../components/matters/timeline/use-timeline-state.ts';
import { forumAbbreviation, istDay } from '../lib/matters/timeline.ts';
import type { TimelineEventView } from '../lib/matters/timeline.ts';
import { matterTabs, resetMatterTabs } from '../lib/matters/tab-registry.ts';
import { registerMatterTabs } from '../lib/matters/tabs.ts';
import {
  TIMELINE_KINDS,
  TIMELINE_KIND_PERMISSIONS,
  allowedTimelineKinds,
  timelineTabHref,
} from '../lib/matters/timeline-tab.ts';
import type { Role, WorkspaceContext } from '../lib/workspace-context.ts';
import { can } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const MATTER_ID = '00000000-0000-4000-8000-000000000001';
const MAIN = '00000000-0000-4000-8000-0000000000a1';
const APPEAL = '00000000-0000-4000-8000-0000000000a2';
const DOC = '00000000-0000-4000-8000-0000000000d1';
const ANCHOR = '00000000-0000-4000-8000-0000000000c1';
const BASE = `/w/demo/matters/${MATTER_ID}/timeline`;

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  dev: true,
  events: [] as TimelineEvent[],
  graph: null as MatterGraph | null,
  anchors: [] as TimelineAnchor[],
  error: null as Error | null,
}));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const graph = vi.hoisted(() => ({
  getMatterGraph: vi.fn(() =>
    page.error === null ? Promise.resolve(page.graph) : Promise.reject(page.error),
  ),
  getMatterTimeline: vi.fn<(...args: unknown[]) => Promise<unknown>>(() =>
    Promise.resolve(page.events),
  ),
  getTimelineAnchors: vi.fn<(...args: unknown[]) => Promise<unknown>>(() =>
    Promise.resolve(page.anchors),
  ),
}));
const logger = vi.hoisted(() => ({ error: vi.fn() }));
const reportError = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => BASE,
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

const { default: TimelinePage } =
  await import('../app/(app)/w/[slug]/matters/[id]/timeline/page.tsx');
const { default: TimelineLoading } =
  await import('../app/(app)/w/[slug]/matters/[id]/timeline/loading.tsx');
const { default: TimelineError } =
  await import('../app/(app)/w/[slug]/matters/[id]/timeline/error.tsx');

const tl = catalogs.en.matterTimeline;
const params = Promise.resolve({ slug: 'demo', id: MATTER_ID });

const provenance = (
  over: Partial<TimelineEvent['provenance']> = {},
): TimelineEvent['provenance'] => ({
  sourceType: 'document',
  sourceRef: null,
  anchorId: null,
  confidence: null,
  confirmationState: 'confirmed',
  ...over,
});

function base(id: string, proceedingId: string | null, day: string, p = provenance()) {
  return {
    id,
    matterId: MATTER_ID,
    proceedingId,
    date: day,
    at: new Date(`${day}T00:00:00+05:30`).toISOString(),
    provenance: p,
    anchorId: p.anchorId,
  };
}

function events(): TimelineEvent[] {
  return [
    {
      ...base('S1', MAIN, '2026-01-15'),
      kind: 'state_change',
      from: 'filed',
      to: 'numbered',
      reason: 'Numbered by the registry (fictional)',
      actorMemberId: null,
      cureDeadline: null,
    },
    {
      ...base('H1', MAIN, '2026-02-01', provenance({ confirmationState: 'proposed' })),
      kind: 'hearing',
      listingId: 'L0',
      outcome: null,
      adjournmentReason: 'Counsel unwell (fictional)',
      nextDateProposed: null,
      nextDateConfirmed: null,
    },
    {
      ...base('O1', MAIN, '2026-02-20', provenance({ anchorId: ANCHOR, confidence: '0.92' })),
      kind: 'order',
      documentId: DOC,
      orderType: 'interim',
      benchId: null,
      nextDate: null,
    },
    {
      ...base('B1', APPEAL, '2026-03-02'),
      kind: 'bench_change',
      fromBenchId: null,
      toBenchId: 'bench-1',
    },
    {
      ...base('L1', APPEAL, '2099-01-10', provenance({ sourceType: 'adapter' })),
      kind: 'listing',
      listType: 'daily',
      stageRaw: 'For hearing',
      stageNorm: null,
      canonical: true,
      benchId: null,
      hallId: null,
      listNo: null,
      itemNo: null,
    },
  ];
}

const forum = { id: 'f1', court: 'Madras High Court', establishment: null, seat: null };

function graphOf(): MatterGraph {
  const node = (id: string, caseType: string, number: string, parentId: string | null) => ({
    id,
    parentId,
    kind: 'main' as const,
    state: 'numbered' as const,
    caseType,
    caseTypeCode: caseType.replaceAll('.', ''),
    number,
    year: 2026,
    srNo: null,
    frNo: null,
    unnumbered: false,
    petitioner: 'Meena Iyer (fictional)',
    respondent: 'State (fictional)',
    forum,
  });
  return {
    nodes: [node(MAIN, 'W.P.', '678', null), node(APPEAL, 'W.A.', '12', null)],
    edges: [{ id: 'l1', from: APPEAL, to: MAIN, kind: 'appeal_from' }],
    groups: [],
  };
}

function anchors(): TimelineAnchor[] {
  return [
    {
      id: ANCHOR,
      documentId: DOC,
      documentKind: 'order',
      pageNo: 3,
      quote: 'The matter is adjourned (fictional quote).',
    },
  ];
}

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

async function renderPage(query: Record<string, string> = {}) {
  const content = await TimelinePage({ params, searchParams: Promise.resolve(query) });
  return withIntl(content);
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
  stubResizeObserver();
  mockMatchMedia({ '(min-width: 768px)': true });
  as('owner');
  page.dev = true;
  page.events = events();
  page.graph = graphOf();
  page.anchors = anchors();
  page.error = null;
  window.history.replaceState(null, '', BASE);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  resetMatterTabs();
});

function row(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-event-id="${id}"]`);
  if (found === null) throw new Error(`no event ${id}`);
  return found;
}

describe('Timeline tab (#41)', () => {
  it('is registered after Proceedings for every role that reads matters', () => {
    registerMatterTabs();
    for (const role of ['owner', 'advocate', 'junior', 'clerk', 'viewer'] as const) {
      const ids = matterTabs(role).map((tab) => tab.id);
      expect(ids).toContain('timeline');
      expect(ids.indexOf('timeline')).toBe(ids.indexOf('proceedings') + 1);
    }
    expect(timelineTabHref('demo', MATTER_ID, { p: MAIN, mode: undefined })).toBe(
      `${BASE}?p=${MAIN}`,
    );
  });

  it('lists events oldest first under month headings, with a Today marker before the future ones', async () => {
    await renderPage();
    const items = screen.getAllByRole('listitem').filter((el) => el.hasAttribute('data-row-id'));
    expect(items.map((el) => el.getAttribute('data-row-id'))).toEqual([
      'state_change:S1',
      'hearing:H1',
      'order:O1',
      'bench_change:B1',
      'listing:L1',
    ]);
    // aria-posinset / aria-setsize across the whole list.
    expect(items.map((el) => el.getAttribute('aria-posinset'))).toEqual(['1', '2', '3', '4', '5']);
    expect(items.every((el) => el.getAttribute('aria-setsize') === '5')).toBe(true);
    expect(screen.getByRole('group', { name: tl.list.label })).toBeTruthy();
    expect(screen.getByText('Jan 2026')).toBeTruthy();
    expect(screen.getByText('Feb 2026')).toBeTruthy();
    const marker = document.querySelector('[data-today-marker]');
    expect(marker?.textContent).toMatch(/^Today · /);
    // The marker sits inside the first future row, above its card.
    expect(items[4]?.contains(marker)).toBe(true);
    expect(row('listing:L1').hasAttribute('data-future')).toBe(true);
    expect(row('order:O1').hasAttribute('data-future')).toBe(false);
  });

  it('shows a Provenance Chip on every event and To confirm only on proposed ones', async () => {
    await renderPage();
    for (const id of [
      'state_change:S1',
      'hearing:H1',
      'order:O1',
      'bench_change:B1',
      'listing:L1',
    ]) {
      expect(row(id).querySelector('[data-slot="provenance-chip"]')).not.toBeNull();
    }
    expect(within(row('hearing:H1')).getByText(tl.event.toConfirm)).toBeTruthy();
    expect(row('hearing:H1').hasAttribute('data-proposed')).toBe(true);
    expect(document.querySelectorAll('[data-slot="to-confirm"]')).toHaveLength(1);
    expect(
      row('order:O1').querySelector('[data-slot="provenance-chip"]')?.getAttribute('aria-label'),
    ).toMatch(/page 3/i);
  });

  it('opens the source at its page in the Documents tab for an event with an anchor', async () => {
    await renderPage();
    const link = within(row('order:O1')).getByRole('link', { name: tl.event.openSource });
    expect(link.getAttribute('href')).toBe(
      `/w/demo/matters/${MATTER_ID}/documents?doc=${DOC}&page=3`,
    );
    expect(within(row('hearing:H1')).queryByRole('link', { name: tl.event.openSource })).toBeNull();
  });

  it('writes dates with tabular numerals in the locale format', async () => {
    await renderPage();
    const time = row('order:O1').querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-02-20');
    expect(time?.className).toContain('tabular-nums');
    expect(time?.textContent).toMatch(/20 Feb 2026/);
  });

  it('shows bench only as a change of composition: no counts, rankings or per-judge figures', async () => {
    await renderPage();
    expect(row('bench_change:B1').textContent).toContain(tl.summary.benchChange);
    const text = document.body.textContent;
    expect(text).not.toMatch(/judge|ranking|rank\b|per-judge|average|\bmost\b/i);
    expect(screen.queryByText(/bench-1/)).toBeNull();
  });

  it('keeps the filters, the selection and the mode in the URL', async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText(tl.filters.search), { target: { value: 'unwell' } });
    expect(window.location.search).toBe('?q=unwell');
    expect(document.querySelectorAll('[data-event-id]')).toHaveLength(1);
    expect(row('hearing:H1')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: tl.filters.clear })[0] as HTMLElement);
    expect(window.location.search).toBe('');
    expect(document.querySelectorAll('[data-event-id]')).toHaveLength(5);

    const appeal = screen
      .getAllByRole('treeitem')
      .find((el) => el.getAttribute('data-item-id') === APPEAL) as HTMLElement;
    fireEvent.click(appeal);
    expect(window.location.search).toBe(`?p=${APPEAL}`);
    expect(
      [...document.querySelectorAll('[data-event-id]')].map((el) =>
        el.getAttribute('data-event-id'),
      ),
    ).toEqual(['bench_change:B1', 'listing:L1']);
    // Shift adds the petition to the selection; "Show all" resets.
    const main = screen
      .getAllByRole('treeitem')
      .find((el) => el.getAttribute('data-item-id') === MAIN) as HTMLElement;
    fireEvent.click(main, { shiftKey: true });
    expect(window.location.search).toBe(`?p=${encodeURIComponent(`${APPEAL},${MAIN}`)}`);
    expect(document.querySelectorAll('[data-event-id]')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: tl.graph.showAll }));
    expect(window.location.search).toBe('');
  });

  it('starts from the filters in the URL it was given', async () => {
    await renderPage({ k: 'order', proposed: '0' });
    expect(
      [...document.querySelectorAll('[data-event-id]')].map((el) =>
        el.getAttribute('data-event-id'),
      ),
    ).toEqual(['order:O1']);
  });

  it('offers Clear filters in the filtered-empty state', async () => {
    await renderPage({ q: 'nothing matches this' });
    expect(screen.getByText(tl.filteredEmpty.title)).toBeTruthy();
    const clear = screen.getAllByRole('button', { name: tl.filters.clear });
    fireEvent.click(clear[clear.length - 1] as HTMLElement);
    expect(document.querySelectorAll('[data-event-id]')).toHaveLength(5);
  });

  it('remembers Combined or Lanes in storage and survives storage that throws', async () => {
    mockMatchMedia({ '(min-width: 768px)': true, '(min-width: 1280px)': true });
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: tl.mode.lanes }));
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('lanes');
    expect(await screen.findByRole('table', { name: tl.lanes.label })).toBeTruthy();
    cleanup();

    window.history.replaceState(null, '', BASE);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: tl.mode.lanes }));
    expect(await screen.findByRole('table', { name: tl.lanes.label })).toBeTruthy();
  });

  it('virtualises a timeline of more than 150 events', async () => {
    page.events = Array.from({ length: 160 }, (_, i) => ({
      ...base(`D${String(i)}`, MAIN, `2026-01-${String((i % 28) + 1).padStart(2, '0')}`),
      kind: 'document_added' as const,
      documentId: DOC,
      documentKind: 'pleading' as const,
      supersedesDocumentId: null,
    }));
    await renderPage();
    expect(document.querySelector('[data-slot="timeline-scroller"]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: tl.list.label })).toBeNull();
  });
});

describe('Timeline states (#41)', () => {
  it('has the empty-matter state with its exact copy', async () => {
    page.events = [];
    await renderPage();
    expect(screen.getByText(tl.empty.title)).toBeTruthy();
    expect(`${tl.empty.title} ${tl.empty.body}`).toBe(
      'Nothing has happened on this matter yet. Hearings, orders and obligations will appear here.',
    );
    expect(screen.getByText(tl.empty.body)).toBeTruthy();
  });

  it('previews the empty and offline states in development', async () => {
    await renderPage({ __state: 'empty' });
    expect(screen.getByText(tl.empty.title)).toBeTruthy();
    cleanup();
    await renderPage({ __state: 'offline' });
    expect(document.querySelector('[data-timeline-offline]')?.textContent).toMatch(
      /^Showing saved timeline from /,
    );
  });

  it('is permission-denied without matter.read or when the service says FORBIDDEN', async () => {
    page.dev = false;
    page.error = new WorkspaceError('FORBIDDEN');
    await renderPage();
    expect(screen.getByText(catalogs.en.matters.denied)).toBeTruthy();
  });

  it('is not-found for another workspace, an unknown id or a restricted matter', async () => {
    page.error = new WorkspaceError('NOT_FOUND');
    await expect(TimelinePage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('throws to the error boundary for an unexpected failure, logging only the error object', async () => {
    page.error = new Error('db is down');
    await expect(TimelinePage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow(
      'Matter timeline could not be loaded',
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('shows the skeleton: the tree outline and six event skeletons', () => {
    withIntl(<TimelineLoading />);
    const skeleton = document.querySelector('[data-slot="timeline-skeleton"]');
    expect(skeleton).not.toBeNull();
    expect(skeleton?.getAttribute('data-pattern-state')).toBe('loading');
    expect(skeleton?.querySelectorAll('.rounded-lg.border')).toHaveLength(6);
  });

  it('shows the error state with Retry and the reference, never the message', () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('secret detail'), { digest: 'abc123' });
    withIntl(<TimelineError error={error} reset={reset} />);
    expect(screen.getByText(tl.error.title)).toBeTruthy();
    expect(screen.getByText('Reference: abc123')).toBeTruthy();
    expect(screen.queryByText(/secret detail/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: tl.error.retry }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(error, { boundary: 'route', digest: 'abc123' });
  });
});

describe('Timeline kinds by role (#41)', () => {
  it('asks the service only for the kinds the role may read', async () => {
    as('viewer');
    await renderPage();
    const [, , input] = graph.getMatterTimeline.mock.calls[0] ?? [];
    expect((input as { kinds: string[] }).kinds.sort()).toEqual(
      [...allowedTimelineKinds((permission) => can('viewer', permission as never))].sort(),
    );
  });

  it('drops the kinds whose permission is missing', () => {
    const only = (granted: string[]) => allowedTimelineKinds((p) => granted.includes(p));
    expect(only(['matter.read'])).toEqual(['state_change']);
    expect(only(['matter.read', 'task.read'])).toEqual([
      'obligation_due',
      'obligation_closed',
      'state_change',
    ]);
    expect(only([])).toEqual([]);
    // Every kind maps to a permission the matrix knows.
    for (const kind of TIMELINE_KINDS) expect(TIMELINE_KIND_PERMISSIONS[kind]).toMatch(/\.read$/);
  });
});

function view(id: string, over: Partial<TimelineEventView> = {}): TimelineEventView {
  return {
    id,
    kind: 'listing',
    date: '2026-01-10',
    dateText: '10 Jan 2026',
    monthKey: '2026-01',
    monthText: 'Jan 2026',
    future: false,
    proposed: false,
    proceedingId: null,
    proceedingLabel: null,
    subject: null,
    qualifier: null,
    fromState: null,
    toState: null,
    searchText: '',
    source: { kind: 'manual', label: 'Entered by you', state: 'confirmed' },
    anchor: null,
    openSourceHref: null,
    ...over,
  };
}

describe('Timeline state (#41)', () => {
  it('parses and serialises the URL, dropping what it does not know', () => {
    const query = parseTimelineQuery(
      new URLSearchParams('p=a,b&k=order,bogus&from=2026-01-01&to=nope&proposed=0&mode=lanes&q=x'),
    );
    expect(query).toEqual({
      p: ['a', 'b'],
      k: ['order'],
      from: '2026-01-01',
      to: '',
      proposed: false,
      mode: 'lanes',
      q: 'x',
    });
    expect(new URLSearchParams(serializeTimelineQuery(query)).get('p')).toBe('a,b');
    expect(serializeTimelineQuery(EMPTY_QUERY)).toBe('');
    expect(isFiltered(EMPTY_QUERY)).toBe(false);
    expect(isFiltered({ ...EMPTY_QUERY, mode: 'lanes' })).toBe(false);
    expect(isFiltered({ ...EMPTY_QUERY, proposed: false })).toBe(true);
  });

  it('selects a proceeding together with its children', () => {
    const nodes = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: null },
    ];
    expect([...selectedProceedings(nodes, ['a'])].sort()).toEqual(['a', 'b', 'c']);
  });

  it('filters by proceeding, kind, dates, proposed and text', () => {
    const all = [
      view('1', { proceedingId: 'a', date: '2026-01-10', kind: 'order', searchText: 'interim' }),
      view('2', { proceedingId: 'b', date: '2026-02-10', proposed: true }),
      view('3', { proceedingId: null, date: '2026-03-10', kind: 'document_added' }),
    ];
    const nodes = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: null },
    ];
    const ids = (patch: object) =>
      filterEvents(all, nodes, { ...EMPTY_QUERY, ...patch }).map((e) => e.id);
    expect(ids({})).toEqual(['1', '2', '3']);
    expect(ids({ p: ['a'] })).toEqual(['1']);
    expect(ids({ k: ['document_added'] })).toEqual(['3']);
    expect(ids({ from: '2026-02-01', to: '2026-02-28' })).toEqual(['2']);
    expect(ids({ proposed: false })).toEqual(['1', '3']);
    expect(ids({ q: 'INTERIM' })).toEqual(['1']);
  });

  it('puts headings, the Today marker and month steps on the rows', () => {
    const rows = buildRows([
      view('1', { monthKey: '2026-01', monthText: 'Jan 2026' }),
      view('2', { monthKey: '2026-01', monthText: 'Jan 2026', date: '2026-01-20' }),
      view('3', { monthKey: '2026-02', monthText: 'Feb 2026', future: true }),
      view('4', { monthKey: '2026-03', monthText: 'Mar 2026', future: true }),
    ]);
    expect(rows.map((r) => r.heading)).toEqual(['Jan 2026', null, 'Feb 2026', 'Mar 2026']);
    expect(rows.map((r) => r.todayBefore)).toEqual([false, false, true, false]);
    expect(todayIndex(rows)).toBe(2);
    expect(monthTarget(rows, 0, 1)).toBe(2);
    expect(monthTarget(rows, 1, -1)).toBe(0);
    expect(monthTarget(rows, 2, -1)).toBe(0);
    expect(monthTarget(rows, 3, 1)).toBeNull();
    const past = buildRows([view('1'), view('2', { date: '2026-01-11' })]);
    expect(past.map((r) => r.todayAfter)).toEqual([false, true]);
    expect(todayIndex(past)).toBe(1);
    expect(todayIndex([])).toBeNull();
  });

  it('abbreviates the forum and finds today in IST', () => {
    expect(forumAbbreviation('Madras High Court')).toBe('Madras HC');
    expect(forumAbbreviation('Chief Metropolitan Magistrate Court')).toBe(
      'Chief Metropolitan Magistrate Court',
    );
    expect(istDay(new Date('2026-03-01T19:00:00Z'))).toBe('2026-03-02');
  });
});
