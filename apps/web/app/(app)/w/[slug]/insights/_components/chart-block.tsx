'use client';
// A chart with its text summary and its data table alternative (#85): the toggle (or `t`) swaps the
// picture for the table. The summary is always present as text.
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';

import { DataTableAlt } from './data-table-alt.tsx';
import { LineChart, type LineChartProps } from './line-chart.tsx';

export interface ChartBlockProps extends LineChartProps {
  tableColumns: readonly string[];
  tableRows: readonly (readonly string[])[];
  tableView: boolean;
  onToggleTable: () => void;
}

export function ChartBlock({
  tableColumns,
  tableRows,
  tableView,
  onToggleTable,
  ...chart
}: ChartBlockProps) {
  const t = useTranslations('insights');
  return (
    <div className="flex flex-col gap-3" data-slot="insights-chart-block">
      {tableView ? (
        <DataTableAlt
          caption={chart.title}
          columns={tableColumns}
          rows={tableRows}
          none={t('table.none')}
        />
      ) : (
        <LineChart {...chart} />
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={tableView}
        onClick={onToggleTable}
        className="self-start"
      >
        {tableView ? t('table.hide') : t('table.show')}
      </Button>
    </div>
  );
}
