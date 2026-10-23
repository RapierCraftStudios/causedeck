'use client';
// Case-status watches on the Proceedings tab (#593): each proceeding either has a watch, with
// "Refresh status", or can be watched at a status source by its CNR or case number. Only the
// parsed result and a proposal come back; no captcha or court page is shown.
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import type { DeviceLookup, RefreshActions } from '../../lib/case-watch/refresh.ts';
import type { Result } from '../../lib/safe-action.ts';

import { RefreshStatusButton } from './refresh-status-button.tsx';

export interface StatusWatchTarget {
  proceedingId: string;
  label: string;
  cnr: string | null;
  caseNumber: string | null;
  /** The member's watch on this proceeding, if any. */
  watchId: string | null;
}

export interface StatusWatchActions {
  add: (raw: unknown) => Promise<Result<unknown>>;
  refresh: RefreshActions;
}

export interface StatusWatchPanelProps {
  workspaceId: string;
  targets: StatusWatchTarget[];
  /** Status source ids a watch can read. */
  sources: string[];
  actions: StatusWatchActions;
  device?: DeviceLookup | undefined;
  disabled?: boolean;
}

export function StatusWatchPanel({
  workspaceId,
  targets,
  sources,
  actions,
  device,
  disabled,
}: StatusWatchPanelProps) {
  const t = useTranslations('caseWatch');
  const router = useRouter();
  const [sourceId, setSourceId] = useState(sources[0] ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (targets.length === 0 || sources.length === 0) return null;

  return (
    <section aria-label={t('panelTitle')} data-slot="status-watch" className="flex flex-col gap-2">
      <h3 className="text-ink-muted text-sm font-medium">{t('panelTitle')}</h3>
      <select
        aria-label={t('sourceLabel')}
        value={sourceId}
        onChange={(e) => {
          setSourceId(e.target.value);
        }}
        className="border-line bg-surface h-9 w-fit rounded-md border px-2 text-sm"
      >
        {sources.map((id) => (
          <option key={id} value={id}>
            {t(`source.${id}`)}
          </option>
        ))}
      </select>
      <ul className="flex flex-col gap-1">
        {targets.map((target) => (
          <li key={target.proceedingId} className="flex flex-wrap items-center gap-2 text-sm">
            <span>{target.label}</span>
            {target.watchId !== null ? (
              <RefreshStatusButton
                workspaceId={workspaceId}
                watchId={target.watchId}
                actions={actions.refresh}
                device={device}
                {...(disabled === undefined ? {} : { disabled })}
                onDone={() => {
                  router.refresh();
                }}
              />
            ) : (
              <Button
                type="button"
                variant="ghost"
                disabled={disabled === true || pending || (target.cnr === null && target.caseNumber === null)}
                onClick={() => {
                  start(async () => {
                    const result = await actions.add({
                      workspaceId,
                      proceedingId: target.proceedingId,
                      sourceId,
                      cnr: target.cnr,
                      caseNumber: target.cnr === null ? target.caseNumber : null,
                    });
                    setMessage(result.ok ? t('added') : t('failed'));
                    if (result.ok) router.refresh();
                  });
                }}
              >
                {t('watch')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p role="status" className="text-ink-muted text-sm">
        {message}
      </p>
    </section>
  );
}
