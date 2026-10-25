'use client';
// One capture in flight (#48): where it came from, the step it is at and a determinate bar for
// that step. A capture saved only on this device carries the offline badge.
import { formatDate, type Locale } from '@causedeck/i18n';
import { Badge } from '@causedeck/ui/badge';
import { Progress } from '@causedeck/ui/progress';
import { CloudOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ProcessingItemView } from '../../lib/inbox/view.ts';

const STEP_PERCENT: Record<ProcessingItemView['status'], number> = {
  received: 15,
  scanning: 40,
  queued: 60,
  processing: 85,
};

export function CaptureRow({ row, locale }: { row: ProcessingItemView; locale: Locale }) {
  const t = useTranslations('inbox');
  const step = row.localOnly ? t('offline.badge') : t(`processing.step.${row.status}`);
  const channel = t(`processing.channel.${row.channel}` as 'processing.channel.share');
  return (
    <li
      data-slot="capture-row"
      className="bg-surface-raised border-line grid gap-2 rounded-xl border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-ink font-medium">{channel}</span>
        <time dateTime={row.createdAt} className="text-ink-muted text-xs tabular-nums">
          {formatDate(row.createdAt, { locale })}
        </time>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-muted">{step}</span>
        {row.localOnly ? (
          <Badge>
            <CloudOff aria-hidden="true" className="size-3" />
            {t('offline.badge')}
          </Badge>
        ) : null}
      </div>
      <Progress
        value={row.localOnly ? 0 : STEP_PERCENT[row.status]}
        aria-label={`${channel}: ${step}`}
      />
    </li>
  );
}
