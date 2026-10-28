'use client';
// Certified copies tab (#68): applied, ready and collected, each with its next action (the
// follow-up date of the copy's open obligation).
import type { CertifiedCopyView } from '@causedeck/core/obligations';
import { ObligationEmpty } from '@causedeck/ui/patterns';
import { useFormatter, useTranslations } from 'next-intl';

export function CopiesTab({ copies }: { copies: CertifiedCopyView[] }) {
  const t = useTranslations('obligations');
  const format = useFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00`), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  if (copies.length === 0) return <ObligationEmpty title={t('copies.empty')} />;
  return (
    <ul data-slot="obligation-copies" className="flex flex-col gap-2">
      {copies.map((copy) => (
        <li key={copy.id} className="border-line bg-surface-raised rounded-lg border p-3 text-sm">
          <p className="text-ink font-medium">
            {copy.matterTitle}
            {copy.caseNumber === null ? '' : ` · ${copy.caseNumber}`}
          </p>
          <p className="text-ink-muted tabular-nums">
            {t(`copies.status.${copy.status}`)} ·{' '}
            {t('copies.applied', { date: day(copy.appliedOn) })}
          </p>
          <p className="text-ink-muted tabular-nums">
            {copy.nextDue === null
              ? t('copies.noNext')
              : t('copies.next', { date: day(copy.nextDue) })}
          </p>
        </li>
      ))}
    </ul>
  );
}
