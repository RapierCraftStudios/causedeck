'use client';
// The practice-school progress list on `/account` (#703 R4): one row per module with its state
// (Done / Not done) and a button that toggles it through `setLearnModuleDoneAction`, which writes
// only the signed-in user's own row. The count line and the buttons update at once (optimistic)
// and are rolled back with a toast when the save fails. Offline, the buttons are disabled.
import { Button } from '@causedeck/ui/button';
import { toast } from '@causedeck/ui/sonner';
import { Check, Circle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Result } from '../../lib/safe-action.ts';

import { useOnline } from './settings-offline-banner.tsx';

export interface LearnModuleView {
  slug: string;
  done: boolean;
}

export interface LearnProgressListProps {
  modules: readonly LearnModuleView[];
  setDone: (input: {
    slug: string;
    done: boolean;
  }) => Promise<Result<{ slug: string; done: boolean }>>;
}

export function LearnProgressList({ modules, setDone }: LearnProgressListProps) {
  const t = useTranslations('settings.account.learn');
  const router = useRouter();
  const online = useOnline();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const isDone = (m: LearnModuleView) => overrides[m.slug] ?? m.done;
  const doneCount = modules.filter(isDone).length;

  async function toggle(m: LearnModuleView) {
    const next = !isDone(m);
    setSaving(m.slug);
    setOverrides((current) => ({ ...current, [m.slug]: next }));
    let result: Result<{ slug: string; done: boolean }>;
    try {
      result = await setDone({ slug: m.slug, done: next });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setSaving(null);
    if (result.ok) {
      toast(next ? t('toast.done') : t('toast.undone'));
      router.refresh();
    } else {
      setOverrides((current) => ({ ...current, [m.slug]: !next }));
      toast(t('toast.failed'));
    }
  }

  return (
    <div data-slot="learn-progress" className="flex flex-col gap-3 py-3">
      <p data-slot="learn-progress-count" aria-live="polite" className="text-sm font-medium">
        {t('progress', { done: doneCount, total: modules.length })}
      </p>
      <ul aria-label={t('listLabel')} className="divide-line flex flex-col divide-y">
        {modules.map((m) => {
          const done = isDone(m);
          const title = t(`modules.${m.slug}` as 'modules.court-day-practice');
          return (
            <li
              key={m.slug}
              data-module={m.slug}
              data-done={done}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                {done ? (
                  <Check aria-hidden="true" className="text-ink size-4 shrink-0" />
                ) : (
                  <Circle aria-hidden="true" className="text-ink-muted size-4 shrink-0" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{title}</span>
                  <span className="text-ink-muted text-xs">
                    {done ? t('status.done') : t('status.pending')}
                  </span>
                </span>
              </span>
              <Button
                variant={done ? 'ghost' : 'secondary'}
                size="sm"
                loading={saving === m.slug}
                disabled={!online || saving !== null}
                aria-label={done ? t('markUndoneLabel', { title }) : t('markDoneLabel', { title })}
                onClick={() => void toggle(m)}
              >
                {done ? t('markUndone') : t('markDone')}
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="text-ink-muted text-xs">{t('note')}</p>
    </div>
  );
}
