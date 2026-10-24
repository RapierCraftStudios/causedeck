// Court insights (#512, D-049, D-050): median listing delay, adjournment rate, median time to
// disposal and pending matters by forum and case type, for this workspace's own matters. A figure
// the analytics layer withheld (too few observations) reads `Not enough data`. The data window and
// the number of matters and hearings behind the figures are always stated.
import type { CourtInsights, InsightCell, Metric } from '@causedeck/intelligence';
import { useTranslations } from 'next-intl';

export interface CourtInsightsViewProps {
  insights: CourtInsights;
  /** The values the filter form shows. */
  filters: { forumId: string; caseType: string };
}

type T = ReturnType<typeof useTranslations<'courtInsights'>>;

function Figure({
  metric,
  render,
  t,
}: {
  metric: Metric;
  render: (value: number) => string;
  t: T;
}) {
  return (
    <td className="px-3 py-2 tabular-nums">
      {metric.value === null ? (
        <span className="text-ink-muted">{t('notEnough')}</span>
      ) : (
        render(metric.value)
      )}
    </td>
  );
}

export function CourtInsightsView({ insights, filters }: CourtInsightsViewProps) {
  const t = useTranslations('courtInsights');
  const forumName = new Map(insights.forums.map((f) => [f.id, f.court]));
  const rows: InsightCell[] = insights.cells.filter((cell) => !cell.suppressed);
  const days = (value: number) => t('days', { count: Math.round(value) });

  return (
    <div data-slot="court-insights" className="flex flex-col gap-4">
      <form
        method="get"
        aria-label={t('filters.label')}
        className="flex flex-wrap items-end gap-3 text-sm"
      >
        <label className="flex flex-col gap-1">
          {t('filters.forum')}
          <select name="forum" defaultValue={filters.forumId} className="rounded border px-2 py-1">
            <option value="">{t('filters.allForums')}</option>
            {insights.forums.map((f) => (
              <option key={f.id} value={f.id}>
                {f.court}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {t('filters.caseType')}
          <input
            name="caseType"
            defaultValue={filters.caseType}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          {t('filters.from')}
          <input
            type="date"
            name="from"
            defaultValue={insights.window.from}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          {t('filters.to')}
          <input
            type="date"
            name="to"
            defaultValue={insights.window.to}
            className="rounded border px-2 py-1"
          />
        </label>
        <button type="submit" className="rounded border px-3 py-1">
          {t('filters.apply')}
        </button>
      </form>

      {rows.length === 0 ? (
        <div data-pattern-state="empty">
          <p className="font-medium">{t('empty.title')}</p>
          <p className="text-ink-muted text-sm">{t('empty.hint')}</p>
        </div>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('table.label')}</caption>
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2">
                {t('table.forum')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('table.caseType')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('table.stage')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('table.period')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('table.listingDelay')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('table.adjournmentRate')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('table.disposalTime')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('table.backlog')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((cell) => (
              <tr key={`${cell.forumId}|${cell.caseTypeCode}|${cell.stage}|${cell.period}`}>
                <td className="px-3 py-2">{forumName.get(cell.forumId) ?? cell.forumId}</td>
                <td className="px-3 py-2">{cell.caseTypeCode}</td>
                <td className="px-3 py-2">
                  {cell.stage === 'unlisted' ? t('unlisted') : cell.stage}
                </td>
                <td className="px-3 py-2">{cell.period}</td>
                <Figure metric={cell.listingDelayDays} render={days} t={t} />
                <Figure
                  metric={cell.adjournmentRate}
                  render={(v) => t('rate', { value: v })}
                  t={t}
                />
                <Figure metric={cell.disposalDays} render={days} t={t} />
                <Figure metric={cell.backlog} render={(v) => t('count', { count: v })} t={t} />
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="text-ink-muted flex flex-col gap-1 text-xs">
        <p>{t('window', { from: insights.window.from, to: insights.window.to })}</p>
        <p>{t('coverage', insights.coverage)}</p>
        <p>{t('minimum', { min: insights.minCell })}</p>
      </footer>
    </div>
  );
}
