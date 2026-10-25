'use client';
// The court watch list and its add form (#482). Plain client component over the three actions:
// add a name or BRN, remove one, and refresh the page after each change.
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type SyntheticEvent } from 'react';

import type { Result } from '../../../../../../lib/safe-action.ts';

import type { CourtWatchView } from './actions.ts';

export interface WatchFormProps {
  workspaceId: string;
  watches: CourtWatchView[];
  add: (raw: unknown) => Promise<Result<CourtWatchView>>;
  remove: (raw: unknown) => Promise<Result<{ removed: true }>>;
}

export function WatchForm({ workspaceId, watches, add, remove }: WatchFormProps) {
  const t = useTranslations('settings.courtWatch');
  const router = useRouter();
  const [kind, setKind] = useState<'name' | 'brn'>('brn');
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const done = (ok: boolean, success: string) => {
    setMessage(ok ? success : t('failed'));
    if (ok) router.refresh();
  };
  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    start(async () => {
      const result = await add({ workspaceId, kind, value });
      if (result.ok) setValue('');
      done(result.ok, t('added'));
    });
  };

  return (
    <div className="flex flex-col gap-3 py-3" data-slot="court-watch">
      {watches.length === 0 ? (
        <p className="text-ink-muted text-sm">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {watches.map((watch) => (
            <li key={watch.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                <span className="text-ink-muted">{t(`kind.${watch.kind}`)}: </span>
                {watch.value}
              </span>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  start(async () => {
                    const result = await remove({ workspaceId, watchId: watch.id });
                    done(result.ok, t('removed'));
                  });
                }}
              >
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <select
          aria-label={t('value')}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as 'name' | 'brn');
          }}
          className="border-line bg-surface h-9 rounded-md border px-2 text-sm"
        >
          <option value="brn">{t('kind.brn')}</option>
          <option value="name">{t('kind.name')}</option>
        </select>
        <input
          aria-label={t('value')}
          value={value}
          maxLength={200}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          className="border-line bg-surface h-9 min-w-0 flex-1 rounded-md border px-2 text-sm"
        />
        <Button type="submit" variant="primary" disabled={pending || value.trim() === ''}>
          {t('add')}
        </Button>
      </form>
      <p role="status" className="text-ink-muted text-sm">
        {message}
      </p>
    </div>
  );
}
