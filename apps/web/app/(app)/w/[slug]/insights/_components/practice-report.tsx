'use client';
// The practice insights dashboard body (#85): the range picker, the Prepared & Kept hero and the
// quieter tiles (obligations, preparedness, load). A calm report, not an analytics wall: one dominant
// number, deltas as text with an arrow, no pies, gauges, rankings or comparisons. `t` switches the
// charts to their data tables. Offline, the page keeps the last computation and says when it was
// computed. The report is print-only for export: nothing is sent anywhere.
import { formatDate, formatTime } from '@causedeck/i18n';
import { EmptyState } from '@causedeck/ui/empty-state';
import { OfflineBanner } from '@causedeck/ui/patterns';
import type { InsightsQuery, PracticeInsights } from '@causedeck/validators/insights';
import { BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useOnline } from '../../../../../../components/matters/matters-offline-banner.tsx';

import { LoadChart } from './load-chart.tsx';
import { ObligationHealthTile } from './obligation-health.tsx';
import { PreparedKeptHero } from './prepared-kept-hero.tsx';
import { PreparednessChart } from './preparedness-chart.tsx';
import { RangePicker } from './range-picker.tsx';

export interface PracticeReportProps {
  slug: string;
  data: PracticeInsights;
  query: InsightsQuery;
  /** Dev preview of the offline banner. */
  forceOffline?: boolean;
}

function isEmpty(data: PracticeInsights): boolean {
  return (
    data.preparedKept.denominator === 0 &&
    data.preparedKept.pending === 0 &&
    data.obligations.due === 0 &&
    data.obligations.capturedTotal === 0 &&
    data.preparedness.n === 0 &&
    data.load.n === 0
  );
}

export function PracticeReport({ slug, data, query, forceOffline = false }: PracticeReportProps) {
  const t = useTranslations('insights');
  const locale = useLocale();
  const online = useOnline() && !forceOffline;
  const [tableView, setTableView] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 't' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable]')
      )
        return;
      setTableView((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const base = `/w/${slug}/insights`;
  const computed = new Date(data.computedAt);
  const when = `${formatDate(computed, { locale })} ${formatTime(computed, { locale })}`;
  const toggle = () => {
    setTableView((v) => !v);
  };

  return (
    <div data-slot="insights" className="mx-auto flex w-full max-w-[1180px] flex-col gap-6">
      {online ? null : (
        <OfflineBanner
          savedAt={computed}
          formatTime={() => when}
          labels={{ message: () => t('offline', { when }) }}
        />
      )}
      <RangePicker basePath={base} query={query} />
      <p className="text-ink-muted text-sm">
        {t('range.window', {
          from: formatDate(`${data.preparedKept.window.from}T12:00:00+05:30`, { locale }),
          to: formatDate(`${data.preparedKept.window.to}T12:00:00+05:30`, { locale }),
        })}
        {' · '}
        {data.scope === 'own' ? t('scopeOwn') : t('scopeWorkspace')}
        {' · '}
        {t('computedAt', { when })}
      </p>
      {isEmpty(data) ? (
        <EmptyState
          icon={<BarChart3 />}
          title={t('empty.title')}
          description={t('empty.body')}
          data-pattern-state="empty"
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
          <PreparedKeptHero data={data.preparedKept} />
          <div
            className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 xl:[&>*:first-child]:col-span-2"
            data-slot="insights-tiles"
          >
            <ObligationHealthTile health={data.obligations} />
            <PreparednessChart
              series={data.preparedness}
              tableView={tableView}
              onToggleTable={toggle}
            />
            <LoadChart series={data.load} tableView={tableView} onToggleTable={toggle} />
          </div>
        </div>
      )}
      <p className="text-ink-muted text-xs">{t('shortcutsHint')}</p>
      <Link
        href={`${base}/report?range=${query.range}${query.from ? `&from=${query.from}` : ''}${query.to ? `&to=${query.to}` : ''}`}
        className="text-ink focus-visible:outline-focus min-h-11 self-start text-sm underline underline-offset-4 focus-visible:outline-2"
      >
        {t('report.open')}
      </Link>
    </div>
  );
}
