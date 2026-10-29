'use client';
// The preparedness tile (#85): the one-tap 1-5 ratings (#86) by week, the baseline and the change.
// Hidden with an explanation when n < 5.
import type { PreparednessSeries } from '@causedeck/validators/insights';
import { useTranslations } from 'next-intl';

import { ChartBlock } from './chart-block.tsx';
import { MetricTile } from './metric-tile.tsx';

export interface PreparednessChartProps {
  series: PreparednessSeries;
  tableView: boolean;
  onToggleTable: () => void;
}

const fmt = (v: number | null) => (v === null ? '' : v.toFixed(1));

export function PreparednessChart({ series, tableView, onToggleTable }: PreparednessChartProps) {
  const t = useTranslations('insights');
  const name = t('preparedness.title');
  if (series.hidden)
    return (
      <MetricTile
        name={name}
        value={null}
        summary=""
        hiddenNote={t('preparedness.hidden', { n: series.n })}
      />
    );
  const summary = `${t('preparedness.summary', { average: fmt(series.average), n: series.n })}${
    series.baselineAverage === null
      ? ''
      : ` ${t('preparedness.baseline', { value: fmt(series.baselineAverage) })}`
  }`;
  return (
    <MetricTile name={name} value={fmt(series.average)} delta={series.delta} summary={summary}>
      <ChartBlock
        title={t('preparedness.chartTitle')}
        description={summary}
        categories={series.points.map((p) => p.week)}
        series={[
          {
            key: 'preparedness',
            label: name,
            color: 1,
            values: series.points.map((p) => p.average),
          },
        ]}
        announce={(week, values) => `${week}: ${name} ${fmt(values[0]?.value ?? null)}`}
        tableColumns={[t('table.week'), t('table.n'), t('table.average')]}
        tableRows={series.points.map((p) => [p.week, String(p.n), fmt(p.average)])}
        tableView={tableView}
        onToggleTable={onToggleTable}
      />
    </MetricTile>
  );
}
