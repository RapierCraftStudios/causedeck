'use client';
// The case-status watch list (#593): each of the member's own watches with its status source, a
// "Refresh status" control (device first, server fallback) and Remove. Watches are added from a
// matter's Proceedings tab, where the proceeding is known. Refreshes the page after each change.
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { RefreshStatusButton } from '../../../../../../components/matters/refresh-status-button.tsx';
import type { DeviceLookup, RefreshActions } from '../../../../../../lib/case-watch/refresh.ts';
import type { Result } from '../../../../../../lib/safe-action.ts';

import type { CaseWatchView } from './actions.ts';

export interface WatchFormProps {
  workspaceId: string;
  watches: CaseWatchView[];
  remove: (raw: unknown) => Promise<Result<{ removed: true }>>;
  refresh: RefreshActions;
  device?: DeviceLookup | undefined;
}

export function WatchForm({ workspaceId, watches, remove, refresh, device }: WatchFormProps) {
  const t = useTranslations('caseWatch');
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-3 py-3" data-slot="case-watch">
      {watches.length === 0 ? (
        <p className="text-ink-muted text-sm">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {watches.map((watch) => (
            <li
              key={watch.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>
                {watch.cnr ?? watch.caseNumber}
                <span className="text-ink-muted">
                  {' · '}
                  {t(`source.${watch.sourceId}`)}
                </span>
              </span>
              <span className="inline-flex items-center gap-2">
                <RefreshStatusButton
                  workspaceId={workspaceId}
                  watchId={watch.id}
                  actions={refresh}
                  device={device}
                  onDone={() => {
                    router.refresh();
                  }}
                />
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    start(async () => {
                      const result = await remove({ workspaceId, watchId: watch.id });
                      setMessage(result.ok ? t('removed') : t('failed'));
                      if (result.ok) router.refresh();
                    });
                  }}
                >
                  {t('remove')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="text-ink-muted text-sm">
        {message}
      </p>
    </div>
  );
}
