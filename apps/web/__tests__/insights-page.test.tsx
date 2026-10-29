// @vitest-environment jsdom
// The practice insights dashboard (#85): the page (denied for a clerk, the junior's own view, the
// range from the URL, the empty state, a failed load throws), the hero reading, the hidden series
// below five answers, the data table alternative and the printable report.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const state = vi.hoisted((): { context: WorkspaceContext | null; data: unknown } => ({
  context: null,
  data: null,
}));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const insights = vi.hoisted(() => ({ getPracticeInsights: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getLocale: () => Promise.resolve('en'),
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(state.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => false }));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/insights', () => insights);

const { default: InsightsPage } = await import('../app/(app)/w/[slug]/insights/page.tsx');
const { default: ReportPage } = await import('../app/(app)/w/[slug]/insights/report/page.tsx');

const en = catalogs.en.insights;
const range = { from: '2026-10-14', to: '2026-11-10' };
const SERIES = (n: number, hidden: boolean) => ({
  window: range,
  n,
  hidden,
  average: hidden ? null : 4.2,
  baselineAverage: hidden ? null : 3.4,
  delta: hidden ? null : 0.8,
  points: hidden
    ? []
    : [
        { week: '2026-W44', n: 3, average: 4 },
        { week: '2026-W45', n: 3, average: 4.4 },
      ],
});
const DATA = {
  computedAt: '2026-11-10T06:00:00.000Z',
  scope: 'workspace',
  preparedKept: {
    window: range,
    numerator: 36,
    denominator: 46,
    rate: 0.7826,
    pending: 2,
    weeks: [
      { week: '2026-W44', numerator: 10, denominator: 16, rate: 0.625 },
      { week: '2026-W45', numerator: 26, denominator: 30, rate: 0.8667 },
    ],
    previous: { window: range, numerator: 11, denominator: 18, rate: 0.6111 },
  },
  obligations: {
    window: range,
    due: 20,
    kept: 16,
    missed: 2,
    missedRate: 0.1,
    keptRate: 0.8,
    capturedTotal: 22,
    captured: 21,
    captureCompleteness: 0.9545,
    deliberateReschedules: 3,
  },
  preparedness: SERIES(6, false),
  load: {
    window: range,
    n: 2,
    hidden: true,
    demand: null,
    worry: null,
    effort: null,
    delta: null,
    baselineAverage: null,
    points: [],
  },
};

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );
const renderPage = async (search: Record<string, string> = {}, slug = 'demo') =>
  withIntl(
    await InsightsPage({
      params: Promise.resolve({ slug }),
      searchParams: Promise.resolve(search),
    }),
  );

beforeEach(() => {
  state.context = testWorkspaceContext('demo', 'advocate');
  insights.getPracticeInsights.mockResolvedValue(DATA);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('insights page', () => {
  it('shows the hero reading with the previous period and the definition', async () => {
    await renderPage();
    expect(document.querySelector('[data-route="insights"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="insights-hero-rate"]')?.textContent).toBe('78%');
    expect(
      screen.getByText(
        'Prepared and kept: 78 percent of 46 appearances. Previous period: 61 percent.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(en.hero.definitionTitle)).toBeTruthy();
    expect(screen.getByText(en.hero.definition)).toBeTruthy();
    expect(screen.getByText('+0.8 vs baseline')).toBeTruthy();
  });

  it('asks the service for the range in the URL and falls back to 12 weeks when malformed', async () => {
    await renderPage({ range: '4w' });
    expect(insights.getPracticeInsights).toHaveBeenLastCalledWith(
      { db: { tx: true } },
      expect.objectContaining({ workspaceId: 'ws-1' }),
      expect.objectContaining({ range: '4w' }),
    );
    cleanup();
    await renderPage({ range: 'custom', from: '2026-11-10', to: '2026-01-01' });
    expect(insights.getPracticeInsights).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ range: '12w' }),
    );
  });

  it('withholds the load series below five answers and says why', async () => {
    await renderPage();
    expect(
      screen.getByText('Load appears after at least 5 weekly pulses. Pulses so far: 2.'),
    ).toBeTruthy();
  });

  it('has a data table alternative for the chart, switched by the button and the t key', async () => {
    await renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: en.tile.expand })[1] as HTMLElement);
    expect(document.querySelector('[data-slot="insights-chart"]')).not.toBeNull();
    expect(screen.getAllByText(/Average 4.2 out of 5 across 6 ratings/).length).toBeGreaterThan(0);
    fireEvent.click(
      within(document.querySelector('[data-slot="insights-chart-block"]') as HTMLElement).getByRole(
        'button',
        {
          name: en.table.show,
        },
      ),
    );
    const table = document.querySelector('[data-slot="insights-data-table"]');
    expect(table?.textContent).toContain('2026-W45');
    expect(document.querySelector('[data-slot="insights-chart"]')).toBeNull();
    fireEvent.keyDown(document.body, { key: 't' });
    expect(document.querySelector('[data-slot="insights-chart"]')).not.toBeNull();
  });

  it('shows the empty state when nothing has happened yet', async () => {
    insights.getPracticeInsights.mockResolvedValue({
      ...DATA,
      preparedKept: {
        ...DATA.preparedKept,
        numerator: 0,
        denominator: 0,
        rate: null,
        pending: 0,
        weeks: [],
      },
      obligations: { ...DATA.obligations, due: 0, capturedTotal: 0, deliberateReschedules: 0 },
      preparedness: SERIES(0, true),
      load: { ...DATA.load, n: 0 },
    });
    await renderPage();
    expect(screen.getByText(en.empty.title)).toBeTruthy();
  });

  it('labels a small sample and a junior sees the own-appearances scope', async () => {
    state.context = testWorkspaceContext('demo', 'junior');
    insights.getPracticeInsights.mockResolvedValue({
      ...DATA,
      scope: 'own',
      preparedKept: { ...DATA.preparedKept, denominator: 4, numerator: 3, rate: 0.75 },
    });
    await renderPage();
    expect(screen.getByText('Small sample: only 4 appearances.')).toBeTruthy();
    expect(screen.getByText(/Your own appearances and measures only/)).toBeTruthy();
  });

  it('is the permission page for a clerk, and core never runs', async () => {
    state.context = testWorkspaceContext('clerk-desk', 'clerk');
    await renderPage({}, 'clerk-desk');
    expect(document.querySelector('[data-route="insights"]')).toBeNull();
    expect(document.querySelector('[data-pattern-state="permission-denied"]')).not.toBeNull();
    expect(insights.getPracticeInsights).not.toHaveBeenCalled();
  });

  it('is the permission page when core denies the load, and throws when it fails', async () => {
    insights.getPracticeInsights.mockRejectedValueOnce(
      Object.assign(new Error('no'), { code: 'FORBIDDEN' }),
    );
    await renderPage();
    expect(document.querySelector('[data-route="insights"]')).toBeNull();
    insights.getPracticeInsights.mockRejectedValueOnce(new Error('db down'));
    await expect(renderPage()).rejects.toThrow('Could not compute the practice insights');
  });
});

describe('insights report', () => {
  it('prints the hero, obligation health, the changes and the definitions, no controls from other data', async () => {
    withIntl(
      await ReportPage({
        params: Promise.resolve({ slug: 'demo' }),
        searchParams: Promise.resolve({}),
      }),
    );
    const report = document.querySelector('[data-route="insights-report"]');
    expect(report?.textContent).toContain('78%');
    expect(report?.textContent).toContain(en.report.definitions);
    expect(report?.textContent).toContain(en.report.private);
    expect(report?.textContent).toContain('+0.8 vs baseline');
    expect(report?.textContent).toContain('Load appears after at least 5');
  });
});
