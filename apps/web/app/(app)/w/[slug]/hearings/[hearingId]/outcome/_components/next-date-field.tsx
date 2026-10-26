/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
'use client';

import { ProvenanceChip, ResolutionField, type Resolution } from '@causedeck/ui/patterns';
import type { OutcomeProposal } from '@causedeck/validators/hearing-outcome';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { formatDate, parseTypedDate } from './outcome-model.ts';

interface NextDateFieldProps {
  nextDate: OutcomeProposal['nextDate'];
  resolution: Resolution;
  onResolve: (next: Resolution) => void;
  disabled?: boolean | undefined;
}

/** The next date: a proposal is confirmed with one action, never pre-selected; or typed, none, to be notified. */
export function NextDateField({ nextDate, resolution, onResolve, disabled }: NextDateFieldProps) {
  const t = useTranslations('outcome');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | undefined>();
  const onTyped = (text: string) => {
    setTyped(text);
    if (text.trim() === '') {
      setError(undefined);
      return;
    }
    const iso = parseTypedDate(text);
    setError(iso === null ? t('nextDate.typedInvalid') : undefined);
    if (iso !== null) onResolve({ kind: 'value', value: iso, source: 'manual' });
  };
  return (
    <ResolutionField
      disabled={disabled}
      proposed={nextDate === undefined ? undefined : nextDate.value}
      source={
        nextDate === undefined ? undefined : (
          <ProvenanceChip
            source={{
              kind: nextDate.source === 'order' ? 'document' : 'capture',
              label: t(`source.${nextDate.source}`),
              ...(nextDate.quote === null ? {} : { quote: nextDate.quote }),
              anchorId: nextDate.anchorId,
              state: 'proposed',
            }}
          />
        )
      }
      resolution={resolution}
      onResolve={onResolve}
      typedText={typed}
      onTypedText={onTyped}
      typedError={error}
      labels={{
        legend: t('nextDate.legend'),
        useProposed: (value) => t('nextDate.useProposed', { date: formatDate(value) }),
        typed: t('nextDate.typed'),
        typedHint: t('nextDate.typedHint'),
        none: t('nextDate.none'),
        deferred: t('nextDate.deferred'),
        required: t('nextDate.required'),
      }}
    />
  );
}
