'use client';
// Storage meter (#65 part 5): how much of the browser's quota the offline cache and everything
// else on this origin use. Warning tone from 80 %, danger when full; the text carries the same
// information, so colour is never the only signal.
import { Progress } from '@causedeck/ui/progress';
import { useTranslations } from 'next-intl';

const WARN_RATIO = 0.8;

export interface StorageMeterProps {
  /** Bytes used; null while loading. */
  used: number | null;
  /** Bytes the browser allows; null when it does not say. */
  quota: number | null;
}

/** `1.5 MB`: binary units, one decimal under 10. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value < 10 && unit > 0 ? value.toFixed(1) : String(Math.round(value));
  return `${text} ${units[unit] ?? 'B'}`;
}

export function StorageMeter({ used, quota }: StorageMeterProps) {
  const t = useTranslations('offline.storage');
  if (used === null) {
    return (
      <div data-slot="storage-meter" data-state="loading" className="flex flex-col gap-1">
        <Progress value={null} aria-label={t('title')} aria-busy="true" />
        <p className="text-ink-muted text-sm">{t('loading')}</p>
      </div>
    );
  }
  if (quota === null || quota <= 0) {
    return (
      <p data-slot="storage-meter" data-state="no-quota" className="text-sm">
        {t('size', { size: formatBytes(used) })}
      </p>
    );
  }
  const ratio = Math.min(used / quota, 1);
  return (
    <div data-slot="storage-meter" data-state="ready" className="flex flex-col gap-1">
      <Progress
        value={Math.round(ratio * 100)}
        aria-label={t('title')}
        tone={ratio >= 1 ? 'danger' : ratio >= WARN_RATIO ? 'warning' : 'accent'}
      />
      <p className="text-sm">{t('used', { used: formatBytes(used), quota: formatBytes(quota) })}</p>
      {ratio >= 1 ? <p className="text-warning text-sm">{t('full')}</p> : null}
    </div>
  );
}
