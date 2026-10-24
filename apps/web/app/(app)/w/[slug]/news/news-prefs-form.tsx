'use client';
// Digest preferences panel of the News page (#481): the practice areas and forums the member
// follows and the time the daily digest arrives. Saves through `saveNewsPreferencesAction`.
import type { NewsForum, NewsPracticeArea } from '@causedeck/core/news';
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import type { Result } from '../../../../../lib/safe-action.ts';

import type { NewsPrefView } from './actions.ts';

interface NewsPrefsFormProps {
  workspaceId: string;
  areas: readonly NewsPracticeArea[];
  forums: readonly NewsForum[];
  initial: NewsPrefView;
  save: (raw: unknown) => Promise<Result<NewsPrefView>>;
}

const TIMES = Array.from({ length: 48 }, (_, i) => {
  const hour = String(Math.floor(i / 2)).padStart(2, '0');
  return `${hour}:${i % 2 === 0 ? '00' : '30'}`;
});

function toggle<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function NewsPrefsForm({ workspaceId, areas, forums, initial, save }: NewsPrefsFormProps) {
  const t = useTranslations('notifications.news');
  const [selectedAreas, setAreas] = useState(initial.practiceAreas);
  const [selectedForums, setForums] = useState(initial.forums);
  const [time, setTime] = useState(initial.digestTime);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [pending, startTransition] = useTransition();
  const onSave = () => {
    startTransition(async () => {
      const result = await save({
        workspaceId,
        practiceAreas: selectedAreas,
        forums: selectedForums,
        digestTime: time,
      });
      setStatus(result.ok ? 'saved' : 'error');
    });
  };

  return (
    <section aria-labelledby="news-prefs-title" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id="news-prefs-title" className="font-serif text-lg font-medium">
          {t('prefs.title')}
        </h2>
        <p className="text-ink-muted text-sm">{t('prefs.description')}</p>
      </header>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t('prefs.areas')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {areas.map((area) => (
            <label key={area} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedAreas.includes(area)}
                onChange={() => {
                  setAreas((prev) => toggle(prev, area));
                }}
              />
              {t(`areas.${area}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t('prefs.forums')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {forums.map((forum) => (
            <label key={forum} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedForums.includes(forum)}
                onChange={() => {
                  setForums((prev) => toggle(prev, forum));
                }}
              />
              {t(`forums.${forum}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">{t('prefs.time')}</span>
        <select
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
          }}
          className="rounded border px-2 py-1"
        >
          {TIMES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3">
        <Button type="button" onClick={onSave} disabled={pending}>
          {t('prefs.save')}
        </Button>
        <p role="status" aria-live="polite" className="text-sm">
          {status === 'saved' ? t('prefs.saved') : null}
        </p>
      </div>
      {status === 'error' ? <Alert tone="danger">{t('prefs.error')}</Alert> : null}
    </section>
  );
}
