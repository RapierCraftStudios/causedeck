'use client';
// The load tile (#85): the weekly 3-item pulse (demand, worry, effort) by week with the change
// against the baseline; hidden with an explanation when n < 5.
import type { LoadSeries } from '@causedeck/validators/insights';
import { useTranslations } from 'next-intl';

import { ChartBlock } from './chart-block.tsx';
import { MetricTile } from './metric-tile.tsx';

export interface LoadChartProps {
  series: LoadSeries;
  tableView: boolean;
  onToggleTable: () => void;
}

const fmt = (v: number | null) => (v === null ? '' : v.toFixed(1));

export function LoadChart({ series, tableView, onToggleTable }: LoadChartProps) {
  const t = useTranslations('insights');
  const name = t('load.title');
  if (series.hidden)
    return (
      <MetricTile
        name={name}
        value={null}
        summary=""
        hiddenNote={t('load.hidden', { n: series.n })}
      />
    );
  const summary = t('load.summary', {
    demand: fmt(series.demand),
    worry: fmt(series.worry),
    effort: fmt(series.effort),
    n: series.n,
  });
  const labels = [t('load.demand'), t('load.worry'), t('load.effort')] as const;
  const overall = fmt(
    series.demand === null || series.worry === null || series.effort === null
      ? null
      : Math.round(((series.demand + series.worry + series.effort) / 3) * 10) / 10,
  );
  return (
    <MetricTile name={name} value={overall} delta={series.delta} summary={summary}>
      <ChartBlock
        title={t('load.chartTitle')}
        description={summary}
        categories={series.points.map((p) => p.week)}
        series={[
          { key: 'demand', label: labels[0], color: 1, values: series.points.map((p) => p.demand) },
          { key: 'worry', label: labels[1], color: 2, values: series.points.map((p) => p.worry) },
          { key: 'effort', label: labels[2], color: 3, values: series.points.map((p) => p.effort) },
        ]}
        announce={(week, values) =>
          `${week}: ${values.map((v) => `${v.label} ${fmt(v.value)}`).join(', ')}`
        }
        tableColumns={[t('table.week'), t('table.n'), ...labels]}
        tableRows={series.points.map((p) => [
          p.week,
          String(p.n),
          fmt(p.demand),
          fmt(p.worry),
          fmt(p.effort),
        ])}
        tableView={tableView}
        onToggleTable={onToggleTable}
      />
    </MetricTile>
  );
}
