'use client';
// The workspace's research provider templates and the add form (#80). Calls the two actions and
// refreshes; the server validates the template again (https only, `{q}` after the host).
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type SyntheticEvent } from 'react';

import type { Result } from '../../../../../../lib/safe-action.ts';

import type { ProviderView } from './actions.ts';

export interface ProviderFormProps {
  workspaceId: string;
  providers: ProviderView[];
  save: (raw: unknown) => Promise<Result<ProviderView>>;
  remove: (raw: unknown) => Promise<Result<{ removed: true }>>;
}

export function ProviderForm({ workspaceId, providers, save, remove }: ProviderFormProps) {
  const t = useTranslations('settingsResearch');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  function done(ok: boolean, reset?: () => void): void {
    setFailed(!ok);
    if (ok) {
      reset?.();
      router.refresh();
    }
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const field = (name: string) => String(data.get(name) ?? '').trim();
    start(async () => {
      const result = await save({
        workspaceId,
        key: field('key'),
        label: field('label'),
        urlTemplate: field('urlTemplate'),
        enabled: data.get('enabled') === 'on',
      });
      done(result.ok, () => {
        form.reset();
      });
    });
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      {providers.length === 0 ? (
        <p className="text-ink-muted text-sm">{t('ownEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {providers.map((provider) => (
            <li key={provider.key} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{provider.label}</span>
              <span className="text-ink-muted break-all">{provider.urlTemplate}</span>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  start(async () => {
                    done((await remove({ workspaceId, key: provider.key })).ok);
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
        <label className="flex flex-col text-sm">
          {t('keyLabel')}
          <input name="key" required maxLength={40} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col text-sm">
          {t('labelLabel')}
          <input name="label" required maxLength={80} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col text-sm">
          {t('templateLabel')}
          <input
            name="urlTemplate"
            required
            maxLength={500}
            aria-describedby="research-template-hint"
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input name="enabled" type="checkbox" defaultChecked />
          {t('enabledLabel')}
        </label>
        <Button type="submit" disabled={pending}>
          {t('save')}
        </Button>
      </form>
      <p id="research-template-hint" className="text-ink-muted text-xs">
        {t('templateHint')}
      </p>
      {failed ? (
        <p role="alert" className="text-sm text-red-600">
          {t('saveError')}
        </p>
      ) : null}
    </div>
  );
}
