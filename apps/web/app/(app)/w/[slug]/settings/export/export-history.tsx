// The export history card (#305, #31 design spec): the requester's last 5 exports in this
// workspace, newest first, with status, request date, size and expiry. Empty: `No exports yet.`
// No hooks beyond translations, so the server page and the polling client card both render it.
// `toExportView` is the serialisable shape the page and the export actions hand to the client.
import { Badge } from '@causedeck/ui/badge';
import { useFormatter, useTranslations } from 'next-intl';

import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';

export type ExportStatus = 'queued' | 'running' | 'ready' | 'failed' | 'expired';

/** An export job as the browser sees it: dates as ISO strings. */
export interface ExportJobView {
  id: string;
  status: ExportStatus;
  progress: number;
  phase: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export function toExportView(job: {
  id: string;
  status: ExportStatus;
  progress: number;
  phase: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}): ExportJobView {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    sizeBytes: job.sizeBytes,
    sha256: job.sha256,
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt?.toISOString() ?? null,
  };
}

/** A ready export past its expiry counts as expired, before the expire job flips it. */
export function effectiveStatus(job: ExportJobView, now: number): ExportStatus {
  if (job.status === 'ready' && job.expiresAt !== null && Date.parse(job.expiresAt) <= now) {
    return 'expired';
  }
  return job.status;
}

/** `1.4 MB`-style size; exports are never shown below a kilobyte. */
export function formatSize(bytes: number): string {
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1024;
  let unit: (typeof units)[number] = 'KB';
  for (const next of units.slice(1)) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${unit}`;
}

const TONE: Record<ExportStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  queued: 'neutral',
  running: 'info',
  ready: 'success',
  failed: 'danger',
  expired: 'neutral',
};

export function ExportHistory({ jobs, now }: { jobs: readonly ExportJobView[]; now: number }) {
  const t = useTranslations('lifecycle.history');
  const format = useFormatter();
  return (
    <SettingSection id="export-history" title={t('title')} data-slot="export-history">
      {jobs.length === 0 ? (
        <p className="text-ink-muted py-3 text-sm" data-pattern-state="empty">
          {t('empty')}
        </p>
      ) : (
        <ul className="divide-line flex flex-col divide-y">
          {jobs.map((job) => {
            const status = effectiveStatus(job, now);
            return (
              <li
                key={job.id}
                data-slot="export-history-item"
                data-status={status}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <span className="flex flex-col">
                  <span>
                    {t('requested', {
                      date: format.dateTime(new Date(job.createdAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                  </span>
                  {job.sizeBytes !== null && status === 'ready' ? (
                    <span className="text-ink-muted">{formatSize(job.sizeBytes)}</span>
                  ) : null}
                </span>
                <Badge tone={TONE[status]}>{t(`status.${status}`)}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </SettingSection>
  );
}
