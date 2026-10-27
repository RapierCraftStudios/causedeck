'use client';
// Defects tab (#68): the registry defects with the date to cure them by and the state of the
// proceeding they were raised on. Read-only; curing a defect is a service call from the matter.
import type { DefectView } from '@causedeck/core/obligations';
import { ObligationEmpty } from '@causedeck/ui/patterns';
import { useFormatter, useTranslations } from 'next-intl';

export function DefectsTab({ defects }: { defects: DefectView[] }) {
  const t = useTranslations('obligations');
  const format = useFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00`), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  if (defects.length === 0) return <ObligationEmpty title={t('defects.empty')} />;
  return (
    <ul data-slot="obligation-defects" className="flex flex-col gap-2">
      {defects.map((defect) => (
        <li key={defect.id} className="border-line bg-surface-raised rounded-lg border p-3 text-sm">
          <p className="text-ink font-medium">{defect.description}</p>
          <p className="text-ink-muted">
            {defect.matterTitle}
            {defect.caseNumber === null ? '' : ` · ${defect.caseNumber}`}
          </p>
          <p className="text-ink-muted tabular-nums">
            {t('defects.raised', { date: day(defect.raisedOn) })} ·{' '}
            {defect.curedOn === null
              ? t('defects.cureBy', { date: day(defect.cureBy) })
              : t('defects.cured', { date: day(defect.curedOn) })}{' '}
            · {t('defects.state', { state: defect.proceedingState })}
          </p>
        </li>
      ))}
    </ul>
  );
}
