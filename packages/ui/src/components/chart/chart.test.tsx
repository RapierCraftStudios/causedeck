// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Bar, BarChart } from 'recharts';
import { describe, expect, it } from 'vitest';

import {
  ChartContainer,
  ChartDataTable,
  ChartLegendContent,
  chartStyle,
  ChartTooltipContent,
  type ChartConfig,
} from './chart';

const config = {
  hearings: { label: 'Hearings', color: 1 },
  filings: { label: 'Filings', color: 2 },
} satisfies ChartConfig;

const data = [
  { month: 'Sep', hearings: 12, filings: 4 },
  { month: 'Oct', hearings: 18, filings: 7 },
];

describe('chartStyle', () => {
  it('maps every series to its --chart-N token', () => {
    expect(chartStyle(config)).toEqual({
      '--color-hearings': 'var(--chart-1)',
      '--color-filings': 'var(--chart-2)',
    });
  });
});

describe('ChartContainer', () => {
  it('is a named figure carrying the series colours', () => {
    render(
      <ChartContainer config={config} title="Hearings per month">
        <BarChart data={data}>
          <Bar dataKey="hearings" fill="var(--color-hearings)" />
        </BarChart>
      </ChartContainer>,
    );
    const figure = screen.getByRole('figure', { name: 'Hearings per month' });
    expect(figure.style.getPropertyValue('--color-hearings')).toBe('var(--chart-1)');
    expect(figure.className).toContain('[&_.recharts-cartesian-grid_line]:stroke-line');
  });

  it('renders a data table alternative from the config', () => {
    render(
      <ChartContainer
        config={config}
        title="Hearings per month"
        fallback={<ChartDataTable data={data} categoryKey="month" categoryLabel="Month" />}
      >
        <BarChart data={data}>
          <Bar dataKey="hearings" />
        </BarChart>
      </ChartContainer>,
    );
    const table = screen.getByRole('table');
    expect(table).toHaveClass('sr-only');
    expect(screen.getByRole('columnheader', { name: 'Filings' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Oct' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '18' })).toBeInTheDocument();
  });
});

describe('ChartTooltipContent and ChartLegendContent', () => {
  it('labels values from the config', () => {
    render(
      <ChartContainer
        config={config}
        title="Hearings"
        fallback={
          <ChartTooltipContent
            active
            label="Oct"
            payload={[
              { dataKey: 'hearings', value: 18 },
              { dataKey: 'filings', value: 7 },
            ]}
            valueFormatter={(value) => `${String(value)} items`}
          />
        }
      >
        <BarChart data={data}>
          <Bar dataKey="hearings" />
        </BarChart>
      </ChartContainer>,
    );
    const tooltip = document.querySelector('[data-slot="chart-tooltip"]');
    expect(tooltip).toHaveTextContent('Oct');
    expect(tooltip).toHaveTextContent('Hearings18 items');
    expect(tooltip).toHaveTextContent('Filings7 items');
  });

  it('renders nothing when inactive, and a legend from the config', () => {
    render(
      <ChartContainer
        config={config}
        title="Hearings"
        fallback={
          <>
            <ChartTooltipContent active={false} payload={[{ dataKey: 'hearings', value: 1 }]} />
            <ChartLegendContent payload={[{ dataKey: 'hearings' }, { dataKey: 'filings' }]} />
          </>
        }
      >
        <BarChart data={data}>
          <Bar dataKey="hearings" />
        </BarChart>
      </ChartContainer>,
    );
    expect(document.querySelector('[data-slot="chart-tooltip"]')).toBeNull();
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Hearings', 'Filings']);
    expect(items[0]?.style.getPropertyValue('--dot')).toBe('var(--color-hearings)');
  });

  it('throws outside a container', () => {
    expect(() => render(<ChartLegendContent payload={[]} />)).toThrow(/ChartContainer/);
  });
});
