// check-stories: n/a Active, Disabled, Loading, Invalid (a read-only graphic; loading uses Skeleton, errors use Alert)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarDays, FileText } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { expect, userEvent, waitFor } from 'storybook/test';

import { INDIC, LONG_LABEL } from '../__fixtures__/labels';
import {
  ChartContainer,
  ChartDataTable,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from './chart';

const DATA = [
  { month: 'May', hearings: 12, filings: 5 },
  { month: 'Jun', hearings: 18, filings: 7 },
  { month: 'Jul', hearings: 9, filings: 4 },
  { month: 'Aug', hearings: 21, filings: 9 },
  { month: 'Sep', hearings: 15, filings: 6 },
  { month: 'Oct', hearings: 24, filings: 11 },
];

const CONFIG = {
  hearings: { label: 'Hearings', color: 1 },
  filings: { label: 'Filings', color: 2 },
} satisfies ChartConfig;

function HearingsChart({
  config = CONFIG,
  title = 'Hearings and filings per month',
}: {
  config?: ChartConfig;
  title?: string;
}) {
  return (
    <ChartContainer
      config={config}
      title={title}
      className="w-xl"
      fallback={<ChartDataTable data={DATA} categoryKey="month" categoryLabel="Month" />}
    >
      <BarChart data={DATA} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={32} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="hearings" fill="var(--color-hearings)" radius={4} />
        <Bar dataKey="filings" fill="var(--color-filings)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}

const meta = {
  title: 'Components/Chart',
  component: HearingsChart,
  subcomponents: { ChartContainer, ChartTooltipContent, ChartLegendContent, ChartDataTable },
} satisfies Meta<typeof HearingsChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, canvasElement }) => {
    const figure = canvas.getByRole('figure', { name: 'Hearings and filings per month' });
    await expect(figure.style.getPropertyValue('--color-hearings')).toBe('var(--chart-1)');
    const bar = await waitFor(() => {
      const el = canvasElement.querySelector('.recharts-bar-rectangle .recharts-rectangle');
      if (!el) throw new Error('no bar');
      return el;
    });
    // The fill resolves to the --chart-1 token.
    const probe = document.createElement('span');
    probe.style.color = 'var(--chart-1)';
    figure.append(probe);
    await expect(getComputedStyle(bar).fill).toBe(getComputedStyle(probe).color);
    probe.remove();
  },
};

export const Hover: Story = {
  play: async ({ canvasElement }) => {
    const bar = await waitFor(() => {
      const el = canvasElement.querySelector('.recharts-bar-rectangle .recharts-rectangle');
      if (!el) throw new Error('no bar');
      return el;
    });
    const box = bar.getBoundingClientRect();
    const surface = canvasElement.querySelector('.recharts-wrapper');
    if (!surface) throw new Error('no chart surface');
    await userEvent.pointer({
      target: surface,
      coords: { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 },
    });
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-slot="chart-tooltip"]')).not.toBeNull(),
    );
  },
};

/** Keyboard: Tab focuses the chart (Recharts accessibility layer), arrows move the tooltip. */
export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector('.recharts-bar-rectangle')).not.toBeNull(),
    );
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-slot="chart-tooltip"]')).not.toBeNull(),
    );
  },
};

export const LineSeries: Story = {
  render: () => (
    <ChartContainer config={CONFIG} title="Hearings trend" className="w-xl">
      <LineChart data={DATA} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line dataKey="hearings" stroke="var(--color-hearings)" strokeWidth={2} dot={false} />
        <Line dataKey="filings" stroke="var(--color-filings)" strokeWidth={2} dot={false} />
      </LineChart>
    </ChartContainer>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <HearingsChart
      config={{
        hearings: { label: 'Hearings', color: 1, icon: CalendarDays },
        filings: { label: 'Filings', color: 2, icon: FileText },
      }}
    />
  ),
};

export const LongText: Story = {
  render: () => (
    <HearingsChart
      title={LONG_LABEL}
      config={{
        hearings: { label: LONG_LABEL, color: 3 },
        filings: { label: 'Filings', color: 4 },
      }}
    />
  ),
};

export const RtlNeutral: Story = {
  render: () => (
    <div dir="rtl">
      <HearingsChart />
    </div>
  ),
};

export const Tamil: Story = {
  render: () => (
    <div lang="ta">
      <HearingsChart
        title={INDIC.ta.hearing}
        config={{
          hearings: { label: INDIC.ta.hearing, color: 1 },
          filings: { label: INDIC.ta.filed, color: 2 },
        }}
      />
    </div>
  ),
};

export const Kannada: Story = {
  render: () => (
    <div lang="kn">
      <HearingsChart
        title={INDIC.kn.hearing}
        config={{
          hearings: { label: INDIC.kn.hearing, color: 1 },
          filings: { label: INDIC.kn.filed, color: 2 },
        }}
      />
    </div>
  ),
};
