'use client';
// The weekly load pulse (#86) on the Today rail: three 1-5 items, saved per member, dismissible
// (button or Esc). The server decides when it is due; this renders only then.
import { PulseCardView, type PovState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { dismissLoadPulseAction, submitLoadPulseAction } from './actions.ts';

const ITEMS = ['demand', 'worry', 'effort'] as const;

export function LoadPulseCard({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('pov.pulse');
  const [state, setState] = useState<PovState | 'dismissed'>('default');
  const [values, setValues] = useState<Record<string, number>>({});
  const complete = ITEMS.every((id) => values[id] !== undefined);

  async function run(call: () => Promise<{ ok: boolean }>, done: PovState | 'dismissed') {
    if (!navigator.onLine) {
      setState('offline');
      return;
    }
    setState('saving');
    try {
      setState((await call()).ok ? done : 'error');
    } catch {
      setState('error');
    }
  }
  const submit = () =>
    complete
      ? run(
          () =>
            submitLoadPulseAction({
              workspaceId,
              demand: values.demand,
              worry: values.worry,
              effort: values.effort,
            }),
          'saved',
        )
      : undefined;
  const dismiss = () => run(() => dismissLoadPulseAction({ workspaceId }), 'dismissed');

  if (state === 'saved' || state === 'dismissed') {
    return (
      <p role="status" data-slot="load-pulse-card" className="text-sm">
        {t(state)}
      </p>
    );
  }
  return (
    <div
      data-slot="load-pulse-card"
      onKeyDown={(event) => {
        if (event.key === 'Escape') void dismiss();
      }}
    >
      <PulseCardView
        labels={{
          title: t('title'),
          intro: t('intro'),
          low: t('low'),
          high: t('high'),
          option: (n) => t('option', { value: n }),
          submit: t('submit'),
          dismiss: t('dismiss'),
          retry: t('retry'),
          messages: {
            saving: t('loading'),
            saved: t('saved'),
            dismissed: t('dismissed'),
            error: t('error'),
            offline: t('offline'),
            denied: t('denied'),
          },
        }}
        items={ITEMS.map((id) => ({ id, label: t(id) }))}
        values={values}
        state={state}
        onChange={(id, v) => {
          setValues((prev) => ({ ...prev, [id]: v }));
        }}
        onSubmit={() => void submit()}
        onDismiss={() => void dismiss()}
        onRetry={() => void submit()}
      />
    </div>
  );
}
