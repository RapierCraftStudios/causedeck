// Practice insights (#85): populated, small sample, own-appearances scope (junior), empty, offline,
// the route's loading, error and denied states, the table alternative and the range keys. All
// figures are fictional. Export names carry the `Insights` prefix: story names are unique across
// apps/web.
import type { InsightsQuery, PracticeInsights } from '@causedeck/validators/insights';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent } from 'storybook/test';

import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import InsightsError from '../error.tsx';
import InsightsLoading from '../loading.tsx';

import { PracticeReport } from './practice-report.tsx';

const window = { from: '2026-10-14', to: '2026-11-10' };
const query: InsightsQuery = { range: '4w' };

const series = (n: number, hidden: boolean) => ({
  window,
  n,
  hidden,
  average: hidden ? null : 4.2,
  baselineAverage: hidden ? null : 3.4,
  delta: hidden ? null : 0.8,
  points: hidden
    ? []
    : [
        { week: '2026-W44', n: 3, average: 3.9 },
        { week: '2026-W45', n: 3, average: 4.5 },
      ],
});

const DATA: PracticeInsights = {
  computedAt: '2026-11-10T06:00:00.000Z',
  scope: 'workspace',
  preparedKept: {
    window,
    numerator: 36,
    denominator: 46,
    rate: 0.7826,
    pending: 2,
    weeks: [
      { week: '2026-W44', numerator: 10, denominator: 16, rate: 0.625 },
      { week: '2026-W45', numerator: 26, denominator: 30, rate: 0.8667 },
    ],
    previous: { window, numerator: 11, denominator: 18, rate: 0.6111 },
  },
  obligations: {
    window,
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
  preparedness: series(6, false),
  load: {
    window,
    n: 6,
    hidden: false,
    demand: 3.8,
    worry: 3.1,
    effort: 3.6,
    baselineAverage: 4.1,
    delta: -0.6,
    points: [
      { week: '2026-W44', n: 3, demand: 3.7, worry: 3, effort: 3.5 },
      { week: '2026-W45', n: 3, demand: 3.9, worry: 3.2, effort: 3.7 },
    ],
  },
};

const meta = {
  title: 'Insights/PracticeReport',
  component: PracticeReport,
  args: { slug: 'demo', data: DATA, query, forceOffline: false },
} satisfies Meta<typeof PracticeReport>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InsightsDefault: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('78%')).toBeVisible();
    await expect(
      canvas.getByText(
        'Prepared and kept: 78 percent of 46 appearances. Previous period: 61 percent.',
      ),
    ).toBeVisible();
    await expect(canvas.getByText('+0.8 vs baseline')).toBeVisible();
  },
};

export const InsightsSmallSample: Story = {
  args: {
    data: {
      ...DATA,
      preparedKept: { ...DATA.preparedKept, numerator: 3, denominator: 4, rate: 0.75, pending: 0 },
      preparedness: series(3, true),
      load: {
        ...DATA.load,
        n: 2,
        hidden: true,
        demand: null,
        worry: null,
        effort: null,
        delta: null,
        points: [],
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Small sample: only 4 appearances.')).toBeVisible();
    await expect(
      canvas.getByText('Preparedness appears after at least 5 ratings. Ratings so far: 3.'),
    ).toBeVisible();
  },
};

/** A junior sees only their own appearances. */
export const InsightsOwnScope: Story = {
  args: { data: { ...DATA, scope: 'own' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Your own appearances and measures only/)).toBeVisible();
  },
};

export const InsightsEmpty: Story = {
  args: {
    data: {
      ...DATA,
      preparedKept: {
        ...DATA.preparedKept,
        numerator: 0,
        denominator: 0,
        rate: null,
        pending: 0,
        weeks: [],
      },
      obligations: {
        ...DATA.obligations,
        due: 0,
        capturedTotal: 0,
        captured: 0,
        deliberateReschedules: 0,
      },
      preparedness: series(0, true),
      load: { ...DATA.load, n: 0, hidden: true, points: [] },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Insights appear after your first few court days')).toBeVisible();
  },
};

export const InsightsOffline: Story = {
  args: { forceOffline: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toBeVisible();
  },
};

/** The chart and its data table alternative; `t` switches too. */
export const InsightsTableAlternative: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getAllByRole('button', { name: 'Show chart and data' })[1] as HTMLElement,
    );
    await userEvent.keyboard('t');
    await expect(canvas.getAllByRole('table').length).toBeGreaterThan(0);
  },
};

/** Arrow keys move across the chart points and announce the values. */
export const InsightsChartKeyboard: Story = {
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(
      canvas.getAllByRole('button', { name: 'Show chart and data' })[1] as HTMLElement,
    );
    // The range picker is also a role=group and comes first: pick the chart by its slot.
    const chart = canvasElement.querySelector<HTMLElement>('[data-slot="insights-chart"]');
    await expect(chart).not.toBeNull();
    chart?.focus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(canvas.getByText(/2026-W44/)).toBeVisible();
  },
};

export const InsightsLoadingState: Story = {
  render: () => <InsightsLoading />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading practice insights')).toBeInTheDocument();
  },
};

export const InsightsErrorState: Story = {
  render: () => <InsightsError error={new Error('boom')} reset={fn()} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Could not load practice insights')).toBeVisible();
  },
};

export const InsightsDenied: Story = {
  render: () => <PermissionDeniedPage />,
};
