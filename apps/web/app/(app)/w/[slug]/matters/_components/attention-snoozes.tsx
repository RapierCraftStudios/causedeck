'use client';
// The snoozes and dismissals recorded on a matter (#70), shown on the matter overview so a snooze
// is visible where it applies. Lifting is a person's act (`matter.write`); viewers and clerks see
// the list without the control. All copy comes from the `attention` catalog.
import type { SnoozeRecord } from '@causedeck/validators/attention';
import { SnoozeHistory } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { liftSnoozeAction } from './attention-actions.ts';

export interface AttentionSnoozesProps {
  workspaceId: string;
  snoozes: readonly SnoozeRecord[];
  canWrite: boolean;
}

export function AttentionSnoozes({ workspaceId, snoozes, canWrite }: AttentionSnoozesProps) {
  const t = useTranslations('attention');
  const [pending, start] = useTransition();
  return (
    <SnoozeHistory
      title={t('snoozes.title')}
      empty={t('snoozes.empty')}
      liftLabel={t('snooze.lift')}
      pending={pending}
      items={snoozes.map((s) => ({
        id: s.id,
        ruleLabel: s.rule === null ? t('snoozes.allRules') : t(`rules.${s.rule}`),
        statusText: s.dismissed
          ? t('snoozes.dismissed')
          : t('snoozes.until', { date: s.until ?? '' }),
        ...(s.reason === null ? {} : { reasonText: t('snoozes.reason', { reason: s.reason }) }),
      }))}
      {...(canWrite
        ? {
            onLift: (id: string) => {
              start(async () => {
                await liftSnoozeAction({ workspaceId, snoozeId: id });
              });
            },
          }
        : {})}
    />
  );
}
