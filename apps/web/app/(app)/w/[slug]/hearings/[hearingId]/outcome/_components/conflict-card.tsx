/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
'use client';

import { SourceCompare } from '@causedeck/ui/patterns';
import type { OutcomeProposal } from '@causedeck/validators/hearing-outcome';
import { useTranslations } from 'next-intl';

import { formatDate } from './outcome-model.ts';

interface ConflictCardProps {
  conflict: NonNullable<OutcomeProposal['conflict']>;
  proposedSource: string;
  chosen: 'current' | 'proposed' | undefined;
  onChoose: (side: 'current' | 'proposed') => void;
  disabled?: boolean | undefined;
}

/** The proposed date against the confirmed one; the date on file stays until the lawyer picks. */
export function ConflictCard({
  conflict,
  proposedSource,
  chosen,
  onChoose,
  disabled,
}: ConflictCardProps) {
  const t = useTranslations('outcome.conflict');
  return (
    <SourceCompare
      title={t('title')}
      current={{
        label: t('current'),
        value: formatDate(conflict.currentDate),
        source: conflict.currentSource,
        chooseLabel: t('keepCurrent'),
      }}
      proposed={{
        label: t('proposed'),
        value: formatDate(conflict.proposedDate),
        source: proposedSource,
        chooseLabel: t('useProposed'),
      }}
      chosen={chosen}
      onChoose={onChoose}
      disabled={disabled}
    />
  );
}
