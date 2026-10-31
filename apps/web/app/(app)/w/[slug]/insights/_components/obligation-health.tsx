'use client';
// The obligations tile (#85): the share kept of what fell due, with the missed rate, the capture
// completeness and the deliberate reschedules (never a miss) as a plain table.
import type { ObligationHealth } from '@causedeck/validators/insights';
import { useTranslations } from 'next-intl';

import { DataTableAlt } from './data-table-alt.tsx';
import { percent } from './format.ts';
import { MetricTile } from './metric-tile.tsx';

const pct = (rate: number | null) => (rate === null ? '' : `${String(percent(rate))}%`);

export function ObligationHealthTile({ health }: { health: ObligationHealth }) {
  const t = useTranslations('insights');
  const name = t('obligations.title');
  if (health.due === 0 && health.capturedTotal === 0 && health.deliberateReschedules === 0)
    return <MetricTile name={name} value={null} summary="" hiddenNote={t('obligations.none')} />;
  const summary = t('obligations.summary', {
    kept: health.kept,
    due: health.due,
    missed: health.missed,
    reschedules: health.deliberateReschedules,
  });
  return (
    <MetricTile name={name} value={pct(health.keptRate) || '-'} summary={summary}>
      <div className="flex flex-col gap-2">
        <DataTableAlt
          caption={name}
          columns={[name, '']}
          none={t('table.none')}
          rows={[
            [t('obligations.due'), String(health.due)],
            [t('obligations.kept'), String(health.kept)],
            [t('obligations.missed'), String(health.missed)],
            [t('obligations.missedRate'), pct(health.missedRate)],
            [t('obligations.captureCompleteness'), pct(health.captureCompleteness)],
            [t('obligations.reschedules'), String(health.deliberateReschedules)],
          ]}
        />
        <p className="text-ink-muted text-xs">
          {t('obligations.captureNote', { captured: health.captured, total: health.capturedTotal })}
        </p>
        <p className="text-ink-muted text-xs">{t('obligations.rescheduleNote')}</p>
      </div>
    </MetricTile>
  );
}
