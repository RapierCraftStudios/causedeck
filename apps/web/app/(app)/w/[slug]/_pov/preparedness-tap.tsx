'use client';
// The preparedness tap (#86): 1-5 or skip after a confirmed outcome. It never blocks confirmation:
// it mounts only once the outcome is confirmed, a failure shows `Try again`, and offline the choice
// is kept on this device (`pov-queue:<hearingId>`) and sent when the connection returns.
import { PreparednessTapView, type PovState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { ratePreparednessAction, skipPreparednessAction } from './actions.ts';

type Pending = { kind: 'rate'; value: number } | { kind: 'skip' };
const queueKey = (hearingId: string) => `pov-queue:${hearingId}`;

export function PreparednessTap({
  workspaceId,
  hearingId,
  canWrite,
}: {
  workspaceId: string;
  hearingId: string;
  /** A viewer is never asked. */
  canWrite: boolean;
}) {
  const t = useTranslations('pov.tap');
  const [state, setState] = useState<PovState>(canWrite ? 'default' : 'denied');
  const [value, setValue] = useState<number | null>(null);
  const [last, setLast] = useState<Pending | null>(null);

  const send = useCallback(
    async (action: Pending) => {
      setLast(action);
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        localStorage.setItem(queueKey(hearingId), JSON.stringify(action));
        setState('offline');
        return;
      }
      setState('saving');
      try {
        const result =
          action.kind === 'rate'
            ? await ratePreparednessAction({ workspaceId, hearingId, rating: action.value })
            : await skipPreparednessAction({ workspaceId, hearingId });
        if (!result.ok) throw new Error(result.error.code);
        localStorage.removeItem(queueKey(hearingId));
        setState(action.kind === 'rate' ? 'saved' : 'skipped');
      } catch {
        setState('error');
      }
    },
    [workspaceId, hearingId],
  );

  const rate = useCallback(
    (next: number) => {
      setValue(next);
      void send({ kind: 'rate', value: next });
    },
    [send],
  );

  // A choice made offline is sent when the connection returns.
  useEffect(() => {
    if (!canWrite) return undefined;
    const sync = () => {
      const raw = localStorage.getItem(queueKey(hearingId));
      if (raw) void send(JSON.parse(raw) as Pending);
    };
    window.addEventListener('online', sync);
    return () => {
      window.removeEventListener('online', sync);
    };
  }, [canWrite, hearingId, send]);

  return (
    <PreparednessTapView
      labels={{
        legend: t('scale'),
        option: (n) => t('option', { value: n }),
        title: t('title'),
        hint: t('hint'),
        skip: t('skip'),
        retry: t('retry'),
        messages: {
          saving: t('loading'),
          saved: t('saved'),
          skipped: t('skipped'),
          error: t('error'),
          offline: t('offline'),
          denied: t('denied'),
        },
      }}
      state={state}
      value={value}
      onRate={rate}
      onSkip={() => void send({ kind: 'skip' })}
      onRetry={() => last && void send(last)}
    />
  );
}
