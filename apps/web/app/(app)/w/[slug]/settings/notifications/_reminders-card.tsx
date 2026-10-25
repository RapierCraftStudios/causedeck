'use client';
// Court-day reminders card (#64): Evening brief (time, default 8:00 pm), Morning changes (7:00 am,
// fixed) and Outcome missing (delay after the last item), each with in-app / push / email switches.
// Every change saves at once through the server action and rolls back if the save fails. States:
// skeleton (loading), error with `Try again`, saved (a check that fades in over 180 ms, 100 ms
// with reduced motion), and denied (the action answered FORBIDDEN). Plain labelled controls, so the
// whole card is keyboard operable.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { Switch } from '@causedeck/ui/switch';
import { REMINDER_CHANNELS, type ReminderChannelValue } from '@causedeck/validators';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import type { Result } from '../../../../../../lib/safe-action.ts';

import type { ReminderPrefsView } from './reminders-actions.ts';

export interface RemindersActions {
  set: (input: {
    workspaceId: string;
    evening?: { time?: string; channels: ReminderPrefsView['evening']['channels'] };
    morning?: { channels: ReminderPrefsView['morning']['channels'] };
    outcome_missing?: {
      delayMinutes?: number;
      channels: ReminderPrefsView['outcome_missing']['channels'];
    };
  }) => Promise<Result<ReminderPrefsView>>;
}

export interface RemindersCardProps {
  workspaceId: string;
  prefs: ReminderPrefsView;
  actions: RemindersActions;
}

type Kind = 'evening' | 'morning' | 'outcome_missing';
const KINDS = ['evening', 'morning', 'outcome_missing'] as const;
const KIND_MESSAGE = {
  evening: 'evening',
  morning: 'morning',
  outcome_missing: 'outcomeMissing',
} as const satisfies Record<Kind, string>;

/** 18:00 to 23:00 on the half hour: the freeze-safe evening window. */
const EVENING_TIMES = Array.from({ length: 11 }, (_, i) => {
  const minutes = 18 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${minutes % 60 === 0 ? '00' : '30'}`;
});
const DELAYS = [30, 60, 90, 120, 180, 240] as const;

type Status = 'idle' | 'saved' | 'error' | 'denied';

export function RemindersCard({ workspaceId, prefs: initial, actions }: RemindersCardProps) {
  const t = useTranslations('reminders.settings');
  const id = useId();
  const [prefs, setPrefs] = useState<ReminderPrefsView>(initial);
  const [status, setStatus] = useState<Status>('idle');

  async function save(next: ReminderPrefsView) {
    const previous = prefs;
    setPrefs(next);
    setStatus('idle');
    try {
      const result = await actions.set({
        workspaceId,
        evening: { time: next.evening.time, channels: next.evening.channels },
        morning: { channels: next.morning.channels },
        outcome_missing: {
          delayMinutes: next.outcome_missing.delayMinutes,
          channels: next.outcome_missing.channels,
        },
      });
      if (result.ok) {
        setPrefs(result.data);
        setStatus('saved');
        return;
      }
      setPrefs(previous);
      setStatus(result.error.code === 'FORBIDDEN' ? 'denied' : 'error');
    } catch {
      setPrefs(previous);
      setStatus('error');
    }
  }

  const toggle = (kind: Kind, channel: ReminderChannelValue, value: boolean) => {
    const channels = { ...prefs[kind].channels, [channel]: value };
    void save({ ...prefs, [kind]: { ...prefs[kind], channels } });
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      data-slot="reminders-card"
      className="border-line flex flex-col gap-4 rounded-lg border p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="font-serif text-lg font-medium">
          {t('title')}
        </h2>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      {KINDS.map((kind) => {
        const name = t(`${KIND_MESSAGE[kind]}.label`);
        return (
          <div key={kind} data-kind={kind} className="border-line flex flex-col gap-2 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col">
                <span className="font-medium">{name}</span>
                <span className="text-ink-muted text-xs">{t(`${KIND_MESSAGE[kind]}.hint`)}</span>
              </div>
              {kind === 'evening' ? (
                <label className="flex items-center gap-2 text-sm">
                  {t('time')}
                  <select
                    value={prefs.evening.time}
                    onChange={(event) => {
                      void save({
                        ...prefs,
                        evening: { ...prefs.evening, time: event.target.value },
                      });
                    }}
                    className="border-line rounded border px-2 py-1"
                  >
                    {EVENING_TIMES.map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {kind === 'outcome_missing' ? (
                <label className="flex items-center gap-2 text-sm">
                  {t('delay')}
                  <select
                    value={prefs.outcome_missing.delayMinutes}
                    onChange={(event) => {
                      void save({
                        ...prefs,
                        outcome_missing: {
                          ...prefs.outcome_missing,
                          delayMinutes: Number(event.target.value),
                        },
                      });
                    }}
                    className="border-line rounded border px-2 py-1"
                  >
                    {[...new Set([...DELAYS, prefs.outcome_missing.delayMinutes])]
                      .sort((a, b) => a - b)
                      .map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes} {t('minutes')}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-4">
              {REMINDER_CHANNELS.map((channel) => (
                <label key={channel} className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={prefs[kind].channels[channel]}
                    aria-label={`${name}: ${t(`channels.${channel}`)}`}
                    data-kind={kind}
                    data-channel={channel}
                    onCheckedChange={(value) => {
                      toggle(kind, channel, value);
                    }}
                  />
                  {t(`channels.${channel}`)}
                </label>
              ))}
            </div>
          </div>
        );
      })}
      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {status === 'saved' ? (
          <span className="text-ink-muted inline-flex items-center gap-1 duration-180 motion-safe:animate-in motion-safe:fade-in motion-reduce:duration-100">
            <Check aria-hidden className="size-4" />
            {t('saved')}
          </span>
        ) : null}
        {status === 'error' ? <span className="text-danger">{t('error')}</span> : null}
        {status === 'denied' ? <span className="text-danger">{t('denied')}</span> : null}
      </p>
    </section>
  );
}

export function RemindersSkeleton() {
  const t = useTranslations('reminders.settings');
  return (
    <SkeletonGroup
      data-slot="reminders-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-3"
    >
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </SkeletonGroup>
  );
}

export function RemindersError() {
  const t = useTranslations('reminders.settings');
  const router = useRouter();
  return (
    <Alert
      tone="danger"
      data-pattern-state="error"
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            router.refresh();
          }}
        >
          {t('retry')}
        </Button>
      }
    >
      {t('error')}
    </Alert>
  );
}
